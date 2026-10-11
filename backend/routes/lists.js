import express from 'express';
import rateLimit from 'express-rate-limit';
import { userOrIpKey } from '../utils/rateLimitKeys.js';
import { isAuthenticated } from '../middleware/auth.js';
import { parsePositiveId } from '../utils/requestParams.js';
import { createLogger } from '../utils/logger.js';
import {
  getActiveLists, getListsByIds, saveCheckin, removeCheckin, CheckinError
} from '../services/poiListService.js';

const logger = createLogger('Lists');

const checkinWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  message: { error: 'Too many check-in changes. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey
});

/**
 * Router for /api/lists (spec 050): curated lists and a signed-in user's
 * check-ins against them. A signed-out visitor's check-ins stay on the device
 * and arrive through /api/user/settings/sync.
 */
export function createListsRouter(pool) {
  const router = express.Router();

  // Lists in season today; with ?ids=, those published lists whatever the season.
  router.get('/', async (req, res) => {
    try {
      if (req.query.ids !== undefined) {
        const ids = String(req.query.ids).split(',').map(parsePositiveId).filter(Boolean).slice(0, 50);
        return res.json(await getListsByIds(pool, ids));
      }
      res.json(await getActiveLists(pool));
    } catch (err) {
      logger.error('GET /api/lists failed:', err);
      res.status(500).json({ error: 'Failed to fetch lists' });
    }
  });

  router.put('/:listId/checkins', isAuthenticated, checkinWriteLimiter, async (req, res) => {
    const listId = parsePositiveId(req.params.listId);
    if (!listId) return res.status(400).json({ error: 'Invalid list id' });
    try {
      res.json(await saveCheckin(pool, req.user.id, listId, req.body || {}));
    } catch (err) {
      if (err instanceof CheckinError) return res.status(err.status).json({ error: err.message });
      logger.error('PUT /api/lists/:listId/checkins failed:', err);
      res.status(500).json({ error: 'Failed to save check-in' });
    }
  });

  // :itemId is a list item's id, or "choice" for the list's free choice.
  router.delete('/:listId/checkins/:itemId', isAuthenticated, checkinWriteLimiter, async (req, res) => {
    const listId = parsePositiveId(req.params.listId);
    const itemId = req.params.itemId === 'choice' ? null : parsePositiveId(req.params.itemId);
    if (!listId || (itemId === null && req.params.itemId !== 'choice')) {
      return res.status(400).json({ error: 'Invalid check-in' });
    }
    try {
      await removeCheckin(pool, req.user.id, listId, itemId);
      res.json({ list_id: listId, item_id: itemId, removed: true });
    } catch (err) {
      logger.error('DELETE /api/lists/:listId/checkins/:itemId failed:', err);
      res.status(500).json({ error: 'Failed to remove check-in' });
    }
  });

  return router;
}
