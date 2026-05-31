import express from 'express';
import rateLimit from 'express-rate-limit';
import { isAuthenticated } from '../middleware/auth.js';

const visitedWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  message: { error: 'Too many visited changes. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : req.ip)
});

function parsePoiId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function createVisitedRouter(pool) {
  const router = express.Router();

  router.get('/', isAuthenticated, async (req, res) => {
    try {
      const visited = await pool.query(
        `SELECT p.id, p.name, p.poi_roles, p.brief_description, p.has_primary_image,
                v.visited_at
           FROM user_visits v
           JOIN pois p ON p.id = v.poi_id
          WHERE v.user_id = $1 AND p.deleted IS NOT TRUE
          ORDER BY v.visited_at DESC`,
        [req.user.id]
      );
      res.json(visited.rows);
    } catch (err) {
      console.error('GET /api/visited failed:', err);
      res.status(500).json({ error: 'Failed to load visited list' });
    }
  });

  // Progress stats: how many distinct locations the user has explored out of the
  // total markable locations (point POIs — the same set rendered as map markers
  // by /api/destinations). Powers the "23 of 371 explored" counter.
  router.get('/stats', isAuthenticated, async (req, res) => {
    try {
      const stats = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM pois
             WHERE 'point' = ANY(poi_roles) AND deleted IS NOT TRUE) AS total,
           (SELECT COUNT(*) FROM user_visits v
              JOIN pois p ON p.id = v.poi_id
             WHERE v.user_id = $1 AND p.deleted IS NOT TRUE
               AND 'point' = ANY(p.poi_roles)) AS visited`,
        [req.user.id]
      );
      const counts = stats.rows[0] || {};
      res.json({ visited: Number(counts.visited) || 0, total: Number(counts.total) || 0 });
    } catch (err) {
      console.error('GET /api/visited/stats failed:', err);
      res.status(500).json({ error: 'Failed to load visited stats' });
    }
  });

  router.post('/:poiId', isAuthenticated, visitedWriteLimiter, async (req, res) => {
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
        `INSERT INTO user_visits (user_id, poi_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [req.user.id, poiId]
      );
      res.status(201).json({ poiId, visited: true });
    } catch (err) {
      console.error('POST /api/visited/:poiId failed:', err);
      res.status(500).json({ error: 'Failed to mark visited' });
    }
  });

  router.delete('/:poiId', isAuthenticated, visitedWriteLimiter, async (req, res) => {
    const poiId = parsePoiId(req.params.poiId);
    if (!poiId) {
      return res.status(400).json({ error: 'Invalid POI id' });
    }
    try {
      await pool.query(
        `DELETE FROM user_visits WHERE user_id = $1 AND poi_id = $2`,
        [req.user.id, poiId]
      );
      res.json({ poiId, visited: false });
    } catch (err) {
      console.error('DELETE /api/visited/:poiId failed:', err);
      res.status(500).json({ error: 'Failed to remove visited' });
    }
  });

  return router;
}
