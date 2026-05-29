import express from 'express';
import crypto from 'crypto';
import { isAuthenticated } from '../middleware/auth.js';
import { validateStops, insertStops, insertTripWithSlugRetry } from './trips.js';
import { addSubscriber } from '../services/buttondownClient.js';

const MAX_SYNC_TRIPS = 50;

/**
 * Router for /api/user/settings/sync.
 *
 * Flushes a freshly-signed-in user's anonymous localStorage state to the
 * backend. Server-wins fill-gaps semantics: timezone is set only when the
 * account's value is still NULL/empty; newsletter subscribe is idempotent
 * server-side; a trip is inserted only when the user has no trip with the
 * same slug, so re-syncs never duplicate. The client persists a stable slug
 * per trip and it is reused server-side via insertTripWithSlugRetry's
 * preferredSlug, keeping client and server slugs aligned for dedup.
 */
export function createUserSettingsRouter(pool) {
  const router = express.Router();

  router.post('/sync', isAuthenticated, async (req, res) => {
    const { timezone, newsletter, trips, favorites } = req.body || {};
    const synced = { timezone: false, newsletter: false, trips: 0, favorites: 0 };

    try {
      if (typeof timezone === 'string' && timezone.trim()) {
        const tzUpdate = await pool.query(
          `UPDATE users SET timezone = $1
            WHERE id = $2 AND (timezone IS NULL OR timezone = '')`,
          [timezone.trim(), req.user.id]
        );
        synced.timezone = tzUpdate.rowCount > 0;
      }

      if (newsletter && newsletter.subscribed && typeof newsletter.email === 'string'
          && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newsletter.email)) {
        try {
          await addSubscriber(newsletter.email, pool);
          await pool.query(
            `INSERT INTO newsletter_subscriptions (email, source) VALUES ($1, $2)`,
            [newsletter.email, 'web']
          ).catch(err => {
            if (err.code !== '23505') throw err;
          });
          synced.newsletter = true;
        } catch (err) {
          console.error('settings/sync newsletter failed:', err.message);
        }
      }

      if (Array.isArray(favorites) && favorites.length > 0) {
        const poiIds = favorites
          .map(Number)
          .filter(n => Number.isInteger(n) && n > 0)
          .slice(0, 500);
        if (poiIds.length > 0) {
          const favInsert = await pool.query(
            `INSERT INTO user_poi_favorites (user_id, poi_id)
             SELECT $1, p FROM UNNEST($2::int[]) AS p
             WHERE EXISTS (SELECT 1 FROM pois WHERE id = p AND deleted IS NOT TRUE)
             ON CONFLICT DO NOTHING`,
            [req.user.id, poiIds]
          );
          synced.favorites = favInsert.rowCount;
        }
      }

      if (Array.isArray(trips) && trips.length > 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          let count = 0;
          for (const trip of trips.slice(0, MAX_SYNC_TRIPS)) {
            if (!trip || typeof trip.name !== 'string' || !trip.name.trim()) continue;
            if (validateStops(trip.stops)) continue;
            const slug = (typeof trip.slug === 'string' && trip.slug.trim())
              ? trip.slug.trim().substring(0, 220)
              : null;
            if (slug) {
              const existing = await client.query(
                `SELECT id FROM trips WHERE user_id = $1 AND slug = $2 LIMIT 1`,
                [req.user.id, slug]
              );
              if (existing.rows.length > 0) continue;
            }
            const created = await insertTripWithSlugRetry(client, {
              user_id: req.user.id,
              name: trip.name.trim().substring(0, 200),
              description: trip.description || null,
              is_featured: false,
              is_public: false,
              preferredSlug: slug
            });
            await insertStops(client, created.id, trip.stops);
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

  router.get('/mcp-token', isAuthenticated, async (req, res) => {
    try {
      const tokenRow = await pool.query(
        'SELECT mcp_token FROM users WHERE id = $1', [req.user.id]
      );
      let token = tokenRow.rows[0]?.mcp_token;
      if (!token) {
        token = crypto.randomBytes(32).toString('base64url');
        await pool.query(
          'UPDATE users SET mcp_token = $1 WHERE id = $2', [token, req.user.id]
        );
      }
      res.json({ token });
    } catch (err) {
      console.error('GET /api/user/settings/mcp-token failed:', err);
      res.status(500).json({ error: 'Failed to get MCP token' });
    }
  });

  router.post('/mcp-token/regenerate', isAuthenticated, async (req, res) => {
    try {
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query(
        'UPDATE users SET mcp_token = $1 WHERE id = $2', [token, req.user.id]
      );
      res.json({ token });
    } catch (err) {
      console.error('POST /api/user/settings/mcp-token/regenerate failed:', err);
      res.status(500).json({ error: 'Failed to regenerate MCP token' });
    }
  });

  return router;
}
