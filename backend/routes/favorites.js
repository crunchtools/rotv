import express from 'express';
import rateLimit from 'express-rate-limit';
import { isAuthenticated } from '../middleware/auth.js';

const favoriteWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  message: { error: 'Too many favorite changes. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : req.ip)
});

function parsePoiId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function createFavoritesRouter(pool) {
  const router = express.Router();

  router.get('/', isAuthenticated, async (req, res) => {
    try {
      // Whitelist tz to IANA Region/City — Postgres AT TIME ZONE takes arbitrary input (PR #368 review)
      const rawTz = req.query.tz;
      const tz = (typeof rawTz === 'string' && /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(rawTz))
        ? rawTz
        : 'America/New_York';
      const favorites = await pool.query(
        `SELECT p.id, p.name, p.poi_roles, p.brief_description, p.has_primary_image,
                f.created_at AS favorited_at,
                ts.status AS trail_status,
                COALESCE(nc.cnt, 0)::int AS news_count,
                COALESCE(ec.cnt, 0)::int AS events_count
           FROM user_poi_favorites f
           JOIN pois p ON p.id = f.poi_id
           LEFT JOIN LATERAL (
             SELECT status FROM trail_status
              WHERE poi_id = p.id ORDER BY created_at DESC LIMIT 1
           ) ts ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS cnt FROM poi_news n
              WHERE n.poi_id = p.id
                AND n.moderation_status IN ('published', 'auto_approved')
           ) nc ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS cnt FROM poi_events e
              WHERE e.poi_id = p.id
                AND e.moderation_status IN ('published', 'auto_approved')
                AND (e.start_date AT TIME ZONE $2)::date >= (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
           ) ec ON true
          WHERE f.user_id = $1 AND p.deleted IS NOT TRUE
          ORDER BY f.created_at DESC`,
        [req.user.id, tz]
      );
      res.json(favorites.rows);
    } catch (err) {
      console.error('GET /api/favorites failed:', err);
      res.status(500).json({ error: 'Failed to load favorites' });
    }
  });

  router.post('/:poiId', isAuthenticated, favoriteWriteLimiter, async (req, res) => {
    const poiId = parsePoiId(req.params.poiId);
    if (!poiId) {
      return res.status(400).json({ error: 'Invalid POI id' });
    }
    try {
      const poi = await pool.query(
        `SELECT id FROM pois WHERE id = $1 AND deleted IS NOT TRUE`,
        [poiId]
      );
      if (poi.rows.length === 0) {
        return res.status(404).json({ error: 'POI not found' });
      }
      await pool.query(
        `INSERT INTO user_poi_favorites (user_id, poi_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [req.user.id, poiId]
      );
      res.status(201).json({ poiId, favorited: true });
    } catch (err) {
      console.error('POST /api/favorites/:poiId failed:', err);
      res.status(500).json({ error: 'Failed to add favorite' });
    }
  });

  router.delete('/:poiId', isAuthenticated, favoriteWriteLimiter, async (req, res) => {
    const poiId = parsePoiId(req.params.poiId);
    if (!poiId) {
      return res.status(400).json({ error: 'Invalid POI id' });
    }
    try {
      await pool.query(
        `DELETE FROM user_poi_favorites WHERE user_id = $1 AND poi_id = $2`,
        [req.user.id, poiId]
      );
      res.json({ poiId, favorited: false });
    } catch (err) {
      console.error('DELETE /api/favorites/:poiId failed:', err);
      res.status(500).json({ error: 'Failed to remove favorite' });
    }
  });

  return router;
}
