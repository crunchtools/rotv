import express from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import { slugifyWithSuffix } from '../utils/slug.js';
import { addSubscriber } from '../services/buttondownClient.js';

const MAX_STOPS = 9;
const MAX_SYNC_TRIPS = 50;

function isFiniteNumber(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n);
}

function validStops(stops) {
  if (!Array.isArray(stops) || stops.length === 0 || stops.length > MAX_STOPS) {
    return false;
  }
  return stops.every(s => s && typeof s === 'object'
    && isFiniteNumber(s.latitude) && isFiniteNumber(s.longitude));
}

async function insertTripWithStops(client, userId, trip) {
  let inserted = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = slugifyWithSuffix(trip.name);
    try {
      const row = await client.query(
        `INSERT INTO trips (user_id, name, description, slug, is_featured, is_public)
         VALUES ($1, $2, $3, $4, FALSE, FALSE)
         RETURNING id`,
        [userId, trip.name, trip.description || null, slug]
      );
      inserted = row.rows[0];
      break;
    } catch (err) {
      if (err.code === '23505' && err.constraint && err.constraint.includes('slug')) {
        continue;
      }
      throw err;
    }
  }
  if (!inserted) throw new Error('slug collision after retries');

  for (const [i, s] of trip.stops.entries()) {
    await client.query(
      `INSERT INTO trip_stops (trip_id, position, poi_id, label, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inserted.id, i + 1, s.poi_id || null, s.label || null, Number(s.latitude), Number(s.longitude)]
    );
  }
  return inserted.id;
}

// POST /api/user/settings/sync
// Flushes a freshly-signed-in user's anonymous localStorage state to the
// backend. Server-wins fill-gaps: timezone only set when currently NULL,
// newsletter subscribe is idempotent server-side, trips inserted only when
// the user has no trip with a matching name (avoids duplicates on re-sync).
export function createUserSettingsRouter(pool) {
  const router = express.Router();

  router.post('/sync', isAuthenticated, async (req, res) => {
    const { timezone, newsletter, trips } = req.body || {};
    const synced = { timezone: false, newsletter: false, trips: 0 };

    try {
      // Timezone — only fill when not already set on the account.
      if (typeof timezone === 'string' && timezone.trim()) {
        const result = await pool.query(
          `UPDATE users SET timezone = $1
            WHERE id = $2 AND (timezone IS NULL OR timezone = '')`,
          [timezone.trim(), req.user.id]
        );
        synced.timezone = result.rowCount > 0;
      }

      // Newsletter — idempotent subscribe (Buttondown handles already-subscribed).
      if (newsletter && newsletter.subscribed && typeof newsletter.email === 'string'
          && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newsletter.email)) {
        try {
          await addSubscriber(newsletter.email, pool);
          await pool.query(
            `INSERT INTO newsletter_subscriptions (email, source) VALUES ($1, $2)`,
            [newsletter.email, 'web']
          ).catch(err => {
            if (!err.message?.includes('duplicate key')) throw err;
          });
          synced.newsletter = true;
        } catch (err) {
          // Newsletter is best-effort during sync; don't fail the whole call.
          console.error('settings/sync newsletter failed:', err.message);
        }
      }

      // Trips — insert only those without a same-named trip for this user.
      if (Array.isArray(trips) && trips.length > 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          let count = 0;
          for (const trip of trips.slice(0, MAX_SYNC_TRIPS)) {
            if (!trip || typeof trip.name !== 'string' || !trip.name.trim()) continue;
            if (!validStops(trip.stops)) continue;
            const existing = await client.query(
              `SELECT id FROM trips WHERE user_id = $1 AND name = $2 LIMIT 1`,
              [req.user.id, trip.name.trim().substring(0, 200)]
            );
            if (existing.rows.length > 0) continue;
            await insertTripWithStops(client, req.user.id, {
              name: trip.name.trim().substring(0, 200),
              description: trip.description,
              stops: trip.stops
            });
            count++;
          }
          await client.query('COMMIT');
          synced.trips = count;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }

      res.json({ synced });
    } catch (err) {
      console.error('POST /api/user/settings/sync failed:', err);
      res.status(500).json({ error: 'Failed to sync settings' });
    }
  });

  return router;
}
