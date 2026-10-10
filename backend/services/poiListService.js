/**
 * Curated lists of places (spec 050): a seasonal program such as the Summit
 * Metro Parks Fall Hiking Spree, published as one list per year.
 */

// A season's dates are the organizer's, so "today" is the valley's day, not UTC's.
const LIST_TIMEZONE = 'America/New_York';

const toNumber = (value) => (value == null ? null : Number(value));

/**
 * Published lists whose season includes a given day, each with its items in order.
 * An item whose POI has been deleted is left out.
 *
 * @param {import('pg').Pool} pool
 * @param {string} [onDate] ISO date to ask about; defaults to today in the valley
 * @returns {Promise<object[]>} Lists as `{ slug, edition, name, description, goal_count,
 *   source_url, starts_on, ends_on, items }`, earliest season first
 */
export async function getActiveLists(pool, onDate) {
  const listRows = await pool.query(
    `SELECT l.id, l.series AS slug, l.edition, l.name, l.description, l.goal_count, l.source_url,
            to_char(l.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(l.ends_on, 'YYYY-MM-DD') AS ends_on
       FROM poi_lists l
      WHERE l.status = 'published'
        AND COALESCE($1::date, (NOW() AT TIME ZONE $2)::date) BETWEEN l.starts_on AND l.ends_on
      ORDER BY l.starts_on, l.id`,
    [onDate || null, LIST_TIMEZONE]
  );
  if (listRows.rows.length === 0) return [];

  const itemRows = await pool.query(
    `SELECT i.list_id, i.poi_id, i.position, i.label, i.note, i.miles, i.rating, i.trail_class,
            i.trailhead, i.nav_latitude, i.nav_longitude
       FROM poi_list_items i
       JOIN pois p ON p.id = i.poi_id
      WHERE i.list_id = ANY($1::int[])
        AND p.deleted IS NOT TRUE
      ORDER BY i.list_id, i.position`,
    [listRows.rows.map(l => l.id)]
  );

  const itemsByList = new Map();
  for (const { list_id: listId, ...item } of itemRows.rows) {
    if (!itemsByList.has(listId)) itemsByList.set(listId, []);
    itemsByList.get(listId).push({
      ...item,
      miles: toNumber(item.miles),
      nav_latitude: toNumber(item.nav_latitude),
      nav_longitude: toNumber(item.nav_longitude)
    });
  }

  return listRows.rows.map(({ id, ...list }) => ({ ...list, items: itemsByList.get(id) || [] }));
}
