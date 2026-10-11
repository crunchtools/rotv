import express from 'express';
import crypto from 'crypto';
import { isAuthenticated } from '../middleware/auth.js';
import { validateStops, insertStops, insertTripWithSlugRetry, rollbackQuietly } from './trips.js';
import { addSubscriber } from '../services/buttondownClient.js';
import { createLogger } from '../utils/logger.js';
import { syncCheckins } from '../services/poiListService.js';

const logger = createLogger('UserSettings');

const MAX_SYNC_TRIPS = 50;

// Display preferences kept on the account (users.preferences), and what each may hold.
const PREFERENCE_VALUES = {
  listSort: ['trail', 'trail-desc', 'park', 'park-desc', 'difficulty', 'difficulty-desc']
};

/**
 * The preferences in a request body that are known and hold an allowed value.
 * @param {object} raw Untrusted input
 * @returns {object} Only the recognised keys; empty when there are none. `listChoices` keeps
 *   its `{ listId: poiId }` pairs that are positive integers, up to 50
 */
export function allowedPreferences(raw) {
  const kept = {};
  for (const [key, values] of Object.entries(PREFERENCE_VALUES)) {
    if (raw && values.includes(raw[key])) kept[key] = raw[key];
  }
  const choices = pickedListChoices(raw?.listChoices);
  if (choices) kept.listChoices = choices;
  return kept;
}

const MAX_LIST_CHOICES = 50;

// The trail picked for each list's free choice before it is hiked: { listId: poiId }.
function pickedListChoices(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const pairs = Object.entries(raw)
    .filter(([listId, poiId]) => /^[1-9]\d{0,8}$/.test(listId) && Number.isInteger(poiId) && poiId > 0)
    .slice(0, MAX_LIST_CHOICES);
  return pairs.length > 0 ? Object.fromEntries(pairs) : null;
}

/**
 * Whitelist of user POI-id-list tables that anonymous localStorage collections
 * sync into. Keys are the sync payload field names; values are the table names.
 * The table name is interpolated into SQL, so only these fixed values are ever
 * used — never request input. Part of the local-first user-data framework
 * (see docs/USER_DATA_FRAMEWORK.md).
 */
const POI_ID_LIST_TABLES = {
  favorites: 'user_poi_favorites',
  visited: 'user_visits'
};

/**
 * Sync an anonymous "array of POI ids" collection into its user_* join table.
 * Server-wins and idempotent: only inserts ids for POIs that still exist and
 * are not deleted, and ON CONFLICT DO NOTHING means re-syncs never duplicate.
 * Returns the number of rows inserted. Reused by every POI-id-list user feature.
 */
async function syncPoiIdList(pool, userId, ids, field) {
  const table = POI_ID_LIST_TABLES[field];
  if (!table || !Array.isArray(ids) || ids.length === 0) return 0;
  const poiIds = ids
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
    .slice(0, 500);
  if (poiIds.length === 0) return 0;
  const inserted = await pool.query(
    // A device may still hold the id of a POI since merged into another
    // (spec 048): store the survivor.
    `INSERT INTO ${table} (user_id, poi_id)
     SELECT DISTINCT $1::int, live.id
       FROM UNNEST($2::int[]) AS p
       JOIN pois held ON held.id = p
       JOIN pois live ON live.id = COALESCE(held.merged_into_id, held.id)
      WHERE live.deleted IS NOT TRUE
     ON CONFLICT DO NOTHING`,
    [userId, poiIds]
  );
  return inserted.rowCount;
}

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
    const { timezone, newsletter, trips, favorites, visited, listCheckins, preferences } = req.body || {};
    const synced = { timezone: false, newsletter: false, trips: 0, favorites: 0, visited: 0, listCheckins: 0, preferences: false };

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
          logger.error('settings/sync newsletter failed, continuing sync:', err.message);
          synced.newsletter = false;
        }
      }

      synced.favorites = await syncPoiIdList(pool, req.user.id, favorites, 'favorites');
      synced.visited = await syncPoiIdList(pool, req.user.id, visited, 'visited');
      synced.listCheckins = await syncCheckins(pool, req.user.id, listCheckins);

      // Fill gaps only: a preference the account already holds wins over the device's.
      const devicePreferences = allowedPreferences(preferences);
      if (Object.keys(devicePreferences).length > 0) {
        await pool.query(
          `UPDATE users SET preferences = $1::jsonb || COALESCE(preferences, '{}'::jsonb) WHERE id = $2`,
          [JSON.stringify(devicePreferences), req.user.id]
        );
        synced.preferences = true;
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
          await rollbackQuietly(client);
          throw err;
        } finally {
          client.release();
        }
      }

      res.json({ synced });
    } catch (err) {
      logger.error('POST /api/user/settings/sync failed:', err);
      res.status(500).json({ error: 'Failed to sync settings' });
    }
  });

  // A signed-in user changing a preference: this one replaces what the account held.
  router.put('/preferences', isAuthenticated, async (req, res) => {
    const changed = allowedPreferences(req.body);
    if (Object.keys(changed).length === 0) {
      return res.status(400).json({ error: 'No known preference to save' });
    }
    try {
      const saved = await pool.query(
        `UPDATE users SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb WHERE id = $2
         RETURNING preferences`,
        [JSON.stringify(changed), req.user.id]
      );
      res.json({ preferences: saved.rows[0]?.preferences || changed });
    } catch (err) {
      logger.error('PUT /api/user/settings/preferences failed:', err);
      res.status(500).json({ error: 'Failed to save preferences' });
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
      logger.error('GET /api/user/settings/mcp-token failed:', err);
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
      logger.error('POST /api/user/settings/mcp-token/regenerate failed:', err);
      res.status(500).json({ error: 'Failed to regenerate MCP token' });
    }
  });

  return router;
}
