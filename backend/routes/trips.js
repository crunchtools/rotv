import express from 'express';
import rateLimit from 'express-rate-limit';
import { isAuthenticated, optionalAuth } from '../middleware/auth.js';
import { slugifyWithSuffix } from '../utils/slug.js';

const MAX_STOPS = 9;

const tripWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Too many trip changes. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : req.ip)
});

function isFiniteNumber(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n);
}

function validateStops(stops) {
  if (!Array.isArray(stops) || stops.length === 0) {
    return 'stops must be a non-empty array';
  }
  if (stops.length > MAX_STOPS) {
    return `stops cannot exceed ${MAX_STOPS} entries`;
  }
  for (const [i, s] of stops.entries()) {
    if (!s || typeof s !== 'object') return `stop ${i + 1} is invalid`;
    if (!isFiniteNumber(s.latitude) || !isFiniteNumber(s.longitude)) {
      return `stop ${i + 1} requires numeric latitude/longitude`;
    }
    const lat = Number(s.latitude);
    const lng = Number(s.longitude);
    if (lat < -90 || lat > 90) return `stop ${i + 1} latitude out of range`;
    if (lng < -180 || lng > 180) return `stop ${i + 1} longitude out of range`;
  }
  return null;
}

function isAdminUser(user) {
  return !!(user && (user.is_admin || user.role === 'admin'));
}

async function loadTripById(pool, id) {
  const tripRows = await pool.query(
    `SELECT id, user_id, name, description, slug, is_featured, is_public,
            is_approved, moderated_by, moderated_at,
            created_at, updated_at
       FROM trips WHERE id = $1`,
    [id]
  );
  if (tripRows.rows.length === 0) return null;
  const trip = tripRows.rows[0];
  const stopRows = await pool.query(
    `SELECT ts.position, ts.poi_id, ts.label, ts.latitude, ts.longitude,
            p.name AS poi_name
       FROM trip_stops ts
       LEFT JOIN pois p ON p.id = ts.poi_id
      WHERE ts.trip_id = $1
      ORDER BY ts.position ASC`,
    [trip.id]
  );
  trip.stops = stopRows.rows;
  return trip;
}

async function insertStops(client, tripId, stops) {
  for (const [i, s] of stops.entries()) {
    await client.query(
      `INSERT INTO trip_stops (trip_id, position, poi_id, label, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tripId,
        i + 1,
        s.poi_id || null,
        s.label || null,
        Number(s.latitude),
        Number(s.longitude)
      ]
    );
  }
}

async function insertTripWithSlugRetry(client, fields, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = slugifyWithSuffix(fields.name);
    try {
      const inserted = await client.query(
        `INSERT INTO trips (user_id, name, description, slug, is_featured, is_public)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [fields.user_id, fields.name, fields.description, slug, fields.is_featured, fields.is_public]
      );
      return inserted.rows[0];
    } catch (err) {
      if (err.code === '23505' && err.constraint && err.constraint.includes('slug')) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('slug collision after retries');
}

export function createTripsRouter(pool) {
  const router = express.Router();

  router.get('/featured', async (_req, res) => {
    try {
      const featuredRows = await pool.query(
        `SELECT id, user_id, name, description, slug, is_featured, is_public,
                is_approved, created_at, updated_at,
                (SELECT COUNT(*) FROM trip_stops WHERE trip_id = trips.id) AS stop_count
           FROM trips
          WHERE is_featured = TRUE
          ORDER BY updated_at DESC`
      );
      res.json(featuredRows.rows);
    } catch (err) {
      console.error('GET /api/trips/featured failed:', err);
      res.status(500).json({ error: 'Failed to load featured trips' });
    }
  });

  router.get('/discover', optionalAuth, async (req, res) => {
    try {
      const currentUserId = req.user && req.user.id ? req.user.id : 0;
      const discoverRows = await pool.query(
        `SELECT t.id, t.user_id, t.name, t.description, t.slug, t.is_featured,
                t.is_public, t.is_approved, t.created_at, t.updated_at,
                u.name AS owner_name,
                (SELECT COUNT(*) FROM trip_stops WHERE trip_id = t.id) AS stop_count
           FROM trips t
           LEFT JOIN users u ON u.id = t.user_id
          WHERE (t.is_featured = TRUE
                 OR (t.is_public = TRUE AND t.is_approved = TRUE))
            AND (t.user_id IS NULL OR t.user_id <> $1)
          ORDER BY t.is_featured DESC, t.updated_at DESC`,
        [currentUserId]
      );
      res.json(discoverRows.rows);
    } catch (err) {
      console.error('GET /api/trips/discover failed:', err);
      res.status(500).json({ error: 'Failed to load trips' });
    }
  });

  router.get('/pending', isAuthenticated, async (req, res) => {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    try {
      const pendingRows = await pool.query(
        `SELECT t.id, t.user_id, t.name, t.description, t.slug, t.is_featured,
                t.is_public, t.is_approved, t.created_at, t.updated_at,
                u.name AS owner_name, u.email AS owner_email,
                (SELECT COUNT(*) FROM trip_stops WHERE trip_id = t.id) AS stop_count
           FROM trips t
           LEFT JOIN users u ON u.id = t.user_id
          WHERE t.is_public = TRUE AND t.is_approved = FALSE
          ORDER BY t.updated_at ASC`
      );
      res.json(pendingRows.rows);
    } catch (err) {
      console.error('GET /api/trips/pending failed:', err);
      res.status(500).json({ error: 'Failed to load pending trips' });
    }
  });

  router.post('/:id/moderate', isAuthenticated, async (req, res) => {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }
    const { action } = req.body || {};
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }
    try {
      const existing = await pool.query('SELECT id FROM trips WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Trip not found' });
      }
      if (action === 'approve') {
        await pool.query(
          `UPDATE trips
              SET is_approved = TRUE,
                  moderated_by = $1,
                  moderated_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $2`,
          [req.user.id, id]
        );
      } else {
        await pool.query(
          `UPDATE trips
              SET is_public = FALSE,
                  is_approved = FALSE,
                  moderated_by = $1,
                  moderated_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $2`,
          [req.user.id, id]
        );
      }
      const fresh = await loadTripById(pool, id);
      res.json(fresh);
    } catch (err) {
      console.error('POST /api/trips/:id/moderate failed:', err);
      res.status(500).json({ error: 'Failed to moderate trip' });
    }
  });

  router.get('/mine', isAuthenticated, async (req, res) => {
    try {
      const mineRows = await pool.query(
        `SELECT id, user_id, name, description, slug, is_featured, is_public,
                is_approved, created_at, updated_at,
                (SELECT COUNT(*) FROM trip_stops WHERE trip_id = trips.id) AS stop_count
           FROM trips
          WHERE user_id = $1
          ORDER BY updated_at DESC`,
        [req.user.id]
      );
      res.json(mineRows.rows);
    } catch (err) {
      console.error('GET /api/trips/mine failed:', err);
      res.status(500).json({ error: 'Failed to load your trips' });
    }
  });

  router.get('/:idOrSlug', optionalAuth, async (req, res) => {
    try {
      const param = req.params.idOrSlug;
      const asNumber = Number(param);
      let id;
      if (Number.isInteger(asNumber) && asNumber > 0 && String(asNumber) === param) {
        id = asNumber;
      } else {
        const slugLookup = await pool.query('SELECT id FROM trips WHERE slug = $1', [param]);
        if (slugLookup.rows.length === 0) return res.status(404).json({ error: 'Trip not found' });
        id = slugLookup.rows[0].id;
      }
      const trip = await loadTripById(pool, id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      const isOwner = req.user && req.user.id === trip.user_id;
      const canView = trip.is_featured || trip.is_public || isOwner;
      if (!canView) return res.status(404).json({ error: 'Trip not found' });
      res.json(trip);
    } catch (err) {
      console.error('GET /api/trips/:idOrSlug failed:', err);
      res.status(500).json({ error: 'Failed to load trip' });
    }
  });

  router.post('/', isAuthenticated, tripWriteLimiter, async (req, res) => {
    const { name, description, is_public, is_featured, stops } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.length > 200) {
      return res.status(400).json({ error: 'name must be 200 characters or fewer' });
    }
    const stopsError = validateStops(stops);
    if (stopsError) return res.status(400).json({ error: stopsError });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await insertTripWithSlugRetry(client, {
        user_id: req.user.id,
        name: name.trim(),
        description: description || null,
        is_featured: !!is_featured && isAdminUser(req.user),
        is_public: !!is_public
      });
      await insertStops(client, created.id, stops);
      await client.query('COMMIT');
      const fresh = await loadTripById(pool, created.id);
      res.status(201).json(fresh);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('POST /api/trips failed:', err);
      res.status(500).json({ error: 'Failed to create trip' });
    } finally {
      client.release();
    }
  });

  router.put('/:id', isAuthenticated, tripWriteLimiter, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }
    const { name, description, is_public, is_featured, stops } = req.body || {};

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT user_id FROM trips WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Trip not found' });
      }
      if (existing.rows[0].user_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not your trip' });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'invalid name' });
        }
        updates.push(`name = $${i++}`);
        values.push(name.trim());
      }
      if (description !== undefined) {
        updates.push(`description = $${i++}`);
        values.push(description || null);
      }
      if (is_public !== undefined) {
        updates.push(`is_public = $${i++}`);
        values.push(!!is_public);
      }
      if (is_featured !== undefined && isAdminUser(req.user)) {
        updates.push(`is_featured = $${i++}`);
        values.push(!!is_featured);
      }
      if (!isAdminUser(req.user)) {
        updates.push(`is_approved = FALSE`);
      }
      updates.push(`updated_at = CURRENT_TIMESTAMP`);

      if (updates.length > 1 || values.length > 0) {
        values.push(id);
        await client.query(
          `UPDATE trips SET ${updates.join(', ')} WHERE id = $${i}`,
          values
        );
      }

      if (stops !== undefined) {
        const stopsError = validateStops(stops);
        if (stopsError) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: stopsError });
        }
        await client.query('DELETE FROM trip_stops WHERE trip_id = $1', [id]);
        await insertStops(client, id, stops);
      }

      await client.query('COMMIT');
      const fresh = await loadTripById(pool, id);
      res.json(fresh);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('PUT /api/trips/:id failed:', err);
      res.status(500).json({ error: 'Failed to update trip' });
    } finally {
      client.release();
    }
  });

  router.delete('/:id', isAuthenticated, tripWriteLimiter, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }
    try {
      const existing = await pool.query('SELECT user_id FROM trips WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Trip not found' });
      }
      if (existing.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'Not your trip' });
      }
      await pool.query('DELETE FROM trips WHERE id = $1', [id]);
      res.status(204).end();
    } catch (err) {
      console.error('DELETE /api/trips/:id failed:', err);
      res.status(500).json({ error: 'Failed to delete trip' });
    }
  });

  router.post('/:id/duplicate', isAuthenticated, tripWriteLimiter, async (req, res) => {
    const sourceId = Number(req.params.id);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `SELECT id, user_id, name, description, is_featured, is_public
           FROM trips WHERE id = $1`,
        [sourceId]
      );
      if (source.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Trip not found' });
      }
      const src = source.rows[0];
      const canRead = src.is_featured || src.is_public || src.user_id === req.user.id;
      if (!canRead) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Trip not found' });
      }

      const created = await insertTripWithSlugRetry(client, {
        user_id: req.user.id,
        name: `${src.name} (copy)`.substring(0, 200),
        description: src.description,
        is_featured: false,
        is_public: false
      });

      const stops = await client.query(
        `SELECT position, poi_id, label, latitude, longitude
           FROM trip_stops WHERE trip_id = $1 ORDER BY position ASC`,
        [sourceId]
      );
      await insertStops(client, created.id, stops.rows);

      await client.query('COMMIT');
      const fresh = await loadTripById(pool, created.id);
      res.status(201).json(fresh);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('POST /api/trips/:id/duplicate failed:', err);
      res.status(500).json({ error: 'Failed to duplicate trip' });
    } finally {
      client.release();
    }
  });

  return router;
}
