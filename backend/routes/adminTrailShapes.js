import express from 'express';
import { isAdmin } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { syncTrailShapes } from '../services/smpTrailShapes.js';

const logger = createLogger('AdminTrailShapes');

/**
 * Router for /api/admin/trail-shapes (#778): redraw short trails from Summit
 * Metro Parks' own lines now, outside the August schedule.
 *
 * @param {import('pg').Pool} pool
 * @param {{sync?: typeof syncTrailShapes}} [options] sync override for tests
 * @returns {import('express').Router}
 */
export function createTrailShapesRouter(pool, { sync = syncTrailShapes } = {}) {
  const router = express.Router();

  // { dryRun: true } reports what would be redrawn and changes nothing.
  router.post('/sync', isAdmin, async (req, res) => {
    try {
      const result = await sync(pool, { dryRun: req.body?.dryRun === true });
      logger.info(`Admin ${req.user.email} ran the trail shape sync: ${result.updated.length} redrawn`);
      res.json(result);
    } catch (error) {
      logger.error('Error syncing trail shapes:', error);
      res.status(502).json({ error: 'Failed to sync trail shapes', message: error.message });
    }
  });

  return router;
}
