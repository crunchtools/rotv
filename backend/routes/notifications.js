import express from 'express';
import { optionalAuth } from '../middleware/auth.js';

const MAX_POIS = 200;

export function createNotificationsRouter(pool) {
  const router = express.Router();

  router.get('/feed', optionalAuth, async (req, res) => {
    let tz = 'America/New_York';
    if (typeof req.query.tz === 'string' && req.query.tz) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: req.query.tz });
        tz = req.query.tz;
      } catch (e) {
        tz = 'America/New_York';
      }
    }
    try {
      let poiIds;
      if (req.user && req.user.id) {
        const favs = await pool.query(
          `SELECT poi_id FROM user_poi_favorites WHERE user_id = $1`,
          [req.user.id]
        );
        poiIds = favs.rows.map(r => r.poi_id);
      } else {
        const raw = typeof req.query.pois === 'string' ? req.query.pois : '';
        const parsed = raw.split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => Number.isInteger(n) && n > 0);
        poiIds = Array.from(new Set(parsed)).slice(0, MAX_POIS);
      }

      if (poiIds.length === 0) {
        return res.json({ news: [], events: [] });
      }

      const news = pool.query(
        `SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.news_type,
                n.publication_date, n.collection_date, p.id AS poi_id, p.name AS poi_name
           FROM poi_news n
           JOIN pois p ON p.id = n.poi_id
          WHERE n.poi_id = ANY($1::int[])
            AND n.moderation_status IN ('published', 'auto_approved')
          ORDER BY COALESCE(n.publication_date, n.collection_date) DESC
          LIMIT 30`,
        [poiIds]
      );
      const events = pool.query(
        `SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.event_type,
                e.location_details, e.source_url, e.collection_date, p.id AS poi_id, p.name AS poi_name
           FROM poi_events e
           JOIN pois p ON p.id = e.poi_id
          WHERE e.poi_id = ANY($1::int[])
            AND e.moderation_status IN ('published', 'auto_approved')
            AND e.start_date >= ((CURRENT_TIMESTAMP AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2
          ORDER BY e.start_date ASC
          LIMIT 30`,
        [poiIds, tz]
      );
      const [newsResult, eventsResult] = await Promise.all([news, events]);
      res.json({ news: newsResult.rows, events: eventsResult.rows });
    } catch (err) {
      console.error('GET /api/notifications/feed failed:', err);
      res.status(500).json({ error: 'Failed to load notification feed' });
    }
  });

  return router;
}
