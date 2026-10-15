import express from 'express';
import { isAdmin } from '../middleware/auth.js';
import { parsePositiveId } from '../utils/requestParams.js';
import { createLogger } from '../utils/logger.js';
import { createMailer } from '../services/mailer.js';
import { adminEmail } from '../config/userAccount.js';
import { refreshSpree } from '../services/listRefreshService.js';

const logger = createLogger('AdminLists');

// What an admin may change on an item, and how each is read from the body.
const ITEM_FIELDS = {
  poi_id: value => parsePositiveId(value),
  label: value => (typeof value === 'string' && value.trim() ? value.trim() : null),
  note: value => (typeof value === 'string' && value.trim() ? value.trim() : null),
  miles: value => (value === '' || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : undefined),
  rating: value => (typeof value === 'string' && value.trim() ? value.trim() : null),
  trail_class: value => (typeof value === 'string' && value.trim() ? value.trim() : null),
  trailhead: value => (typeof value === 'string' && value.trim() ? value.trim() : null),
  nav_latitude: value => (value === '' || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : undefined),
  nav_longitude: value => (value === '' || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : undefined)
};

const ITEM_COLUMNS = Object.keys(ITEM_FIELDS);
const EMPTY_ITEM = Object.fromEntries(ITEM_COLUMNS.map(column => [column, null]));

// The fields of `body` an admin sent, read; a value that cannot be read is an error.
function readItemFields(body) {
  const fields = {};
  for (const [name, read] of Object.entries(ITEM_FIELDS)) {
    if (!(name in (body || {}))) continue;
    const value = read(body[name]);
    if (value === undefined || (name === 'poi_id' && value === null)) {
      throw Object.assign(new Error(`${name} is not valid`), { status: 400 });
    }
    fields[name] = value;
  }
  return fields;
}

async function loadList(pool, listId) {
  const { rows: [list] } = await pool.query(
    `SELECT id, series, edition, name, status, featured, form_url, form_file, hero_image, refresh_report,
            to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
       FROM poi_lists WHERE id = $1`,
    [listId]
  );
  if (!list) return null;
  const { rows: items } = await pool.query(
    `SELECT i.id, i.poi_id, p.name AS poi_name, i.position, i.label, i.note, i.miles::float AS miles, i.rating,
            i.trail_class, i.trailhead, i.nav_latitude::float AS nav_latitude, i.nav_longitude::float AS nav_longitude,
            i.geometry IS NOT NULL AS has_section
       FROM poi_list_items i JOIN pois p ON p.id = i.poi_id
      WHERE i.list_id = $1 ORDER BY i.position`,
    [listId]
  );
  return { ...list, items };
}

/**
 * Router for /api/admin/lists (spec 052): the seasonal lists, drafts first, and
 * what an admin does to a draft before visitors see it.
 *
 * @param {import('pg').Pool} pool
 * @param {{mailer?: {enabled: boolean, send: (msg: {to: string, subject: string, text: string}) => Promise<string>}}} [options]
 *   mailer override for tests; defaults to createMailer() from the environment
 * @returns {import('express').Router}
 */
export function createAdminListsRouter(pool, { mailer } = {}) {
  const router = express.Router();
  const listMailer = () => mailer || createMailer();

  router.get('/', isAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM poi_lists ORDER BY (status = 'draft') DESC, edition DESC, id DESC LIMIT 20`
      );
      res.json(await Promise.all(rows.map(row => loadList(pool, row.id))));
    } catch (error) {
      logger.error('Error listing seasonal lists:', error);
      res.status(500).json({ error: 'Failed to load lists' });
    }
  });

  // Every live trail, for picking the trail an unmatched entry is.
  router.get('/trails', isAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name FROM pois WHERE 'trail' = ANY(poi_roles) AND deleted IS NOT TRUE ORDER BY name`
      );
      res.json(rows);
    } catch (error) {
      logger.error('Error listing trails:', error);
      res.status(500).json({ error: 'Failed to load trails' });
    }
  });

  // Look for the district's spree for a year (default: this year) and draft it.
  router.post('/refresh', isAdmin, async (req, res) => {
    const edition = req.body?.edition == null ? undefined : Number(req.body.edition);
    // A season a few years either side of this one; anything else is a typo.
    if (edition !== undefined && !(Number.isInteger(edition) && Math.abs(edition - new Date().getFullYear()) <= 5)) {
      return res.status(400).json({ error: 'edition must be a year near this one' });
    }
    try {
      const result = await refreshSpree(pool, { edition, mailer: listMailer(), adminEmail: adminEmail() });
      logger.info(`Admin ${req.user.email} ran the spree refresh: ${result.status}`);
      res.json(result);
    } catch (error) {
      logger.error('Error refreshing the spree:', error);
      res.status(502).json({ error: 'Failed to read the district\'s spree', message: error.message });
    }
  });

  // Every change below is to a draft; a published list is changed by a migration or by hand.
  const draftOr404 = async (req, res) => {
    const listId = parsePositiveId(req.params.listId);
    const list = listId && await loadList(pool, listId);
    if (!list) { res.status(404).json({ error: 'List not found' }); return null; }
    if (list.status !== 'draft') { res.status(409).json({ error: 'Only a draft can be changed here' }); return null; }
    return list;
  };

  router.post('/:listId/items', isAdmin, async (req, res) => {
    try {
      const list = await draftOr404(req, res);
      if (!list) return;
      const fields = readItemFields(req.body);
      if (!fields.poi_id) return res.status(400).json({ error: 'poi_id is required' });
      const item = { ...EMPTY_ITEM, ...fields };
      await pool.query(
        `INSERT INTO poi_list_items (list_id, position, poi_id, label, note, miles, rating, trail_class,
                                     trailhead, nav_latitude, nav_longitude)
         VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM poi_list_items WHERE list_id = $1),
                 $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [list.id, ...ITEM_COLUMNS.map(column => item[column])]
      );
      // The district's entry it answers is no longer unmatched.
      if (typeof req.body.entry === 'string') {
        await pool.query(
          `UPDATE poi_lists SET refresh_report = jsonb_set(refresh_report, '{unmatched}',
             COALESCE((SELECT jsonb_agg(u) FROM jsonb_array_elements(refresh_report->'unmatched') u WHERE u->>'entry' <> $2), '[]'::jsonb))
           WHERE id = $1 AND refresh_report ? 'unmatched'`,
          [list.id, req.body.entry]
        );
      }
      res.status(201).json(await loadList(pool, list.id));
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      logger.error('Error adding a list item:', error);
      res.status(500).json({ error: 'Failed to add the trail' });
    }
  });

  router.put('/:listId/items/:itemId', isAdmin, async (req, res) => {
    try {
      const list = await draftOr404(req, res);
      if (!list) return;
      const itemId = parsePositiveId(req.params.itemId);
      const fields = readItemFields(req.body);
      if (!itemId || Object.keys(fields).length === 0) return res.status(400).json({ error: 'Nothing to change' });
      // Only the fields sent change, in one statement, so two admins saving
      // different fields of one item do not undo each other.
      const result = await pool.query(
        `UPDATE poi_list_items
            SET poi_id = CASE WHEN $3::boolean THEN $4::int ELSE poi_id END,
                label = CASE WHEN $5::boolean THEN $6::text ELSE label END,
                note = CASE WHEN $7::boolean THEN $8::text ELSE note END,
                miles = CASE WHEN $9::boolean THEN $10::numeric ELSE miles END,
                rating = CASE WHEN $11::boolean THEN $12::text ELSE rating END,
                trail_class = CASE WHEN $13::boolean THEN $14::text ELSE trail_class END,
                trailhead = CASE WHEN $15::boolean THEN $16::text ELSE trailhead END,
                nav_latitude = CASE WHEN $17::boolean THEN $18::numeric ELSE nav_latitude END,
                nav_longitude = CASE WHEN $19::boolean THEN $20::numeric ELSE nav_longitude END
          WHERE id = $1 AND list_id = $2`,
        [itemId, list.id, ...ITEM_COLUMNS.flatMap(column => [column in fields, column in fields ? fields[column] : null])]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found' });
      res.json(await loadList(pool, list.id));
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      logger.error('Error changing a list item:', error);
      res.status(500).json({ error: 'Failed to save the trail' });
    }
  });

  router.delete('/:listId/items/:itemId', isAdmin, async (req, res) => {
    try {
      const list = await draftOr404(req, res);
      if (!list) return;
      await pool.query('DELETE FROM poi_list_items WHERE id = $1 AND list_id = $2', [parsePositiveId(req.params.itemId), list.id]);
      res.json(await loadList(pool, list.id));
    } catch (error) {
      logger.error('Error removing a list item:', error);
      res.status(500).json({ error: 'Failed to remove the trail' });
    }
  });

  router.post('/:listId/publish', isAdmin, async (req, res) => {
    try {
      const list = await draftOr404(req, res);
      if (!list) return;
      if (list.items.length === 0) return res.status(400).json({ error: 'A list needs at least one trail' });
      await pool.query(`UPDATE poi_lists SET status = 'published', updated_at = NOW() WHERE id = $1`, [list.id]);
      logger.info(`Admin ${req.user.email} published list ${list.id} (${list.series} ${list.edition})`);
      res.json(await loadList(pool, list.id));
    } catch (error) {
      logger.error('Error publishing a list:', error);
      res.status(500).json({ error: 'Failed to publish the list' });
    }
  });

  return router;
}
