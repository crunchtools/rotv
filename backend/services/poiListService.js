/**
 * Curated lists of places (spec 050): a seasonal program such as the Summit
 * Metro Parks Fall Hiking Spree, published as one list per year, and the dated
 * check-ins people log against it.
 */

// A season's dates are the organizer's, so "today" is the valley's day, not UTC's.
const LIST_TIMEZONE = 'America/New_York';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SYNC_CHECKINS = 200;

const toNumber = (value) => (value == null ? null : Number(value));

/** Today's date in the valley, as YYYY-MM-DD. */
export function todayInValley(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIST_TIMEZONE }).format(now);
}

/** A check-in the rules refuse; `status` is the HTTP status to answer with. */
export class CheckinError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CheckinError';
    this.status = status;
  }
}

// Published lists that are in season on `onDate`, or named in `ids`; either may be null.
async function loadLists(pool, onDate, ids) {
  const listRows = await pool.query(
    `SELECT l.id, l.series AS slug, l.edition, l.name, l.description, l.goal_count, l.source_url,
            l.featured, l.choice_label, l.choice_description, l.rewards, l.form_url, l.hero_image, l.hero_credit, l.organizer_poi_id, l.form_file, l.form_layout,
            to_char(l.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(l.ends_on, 'YYYY-MM-DD') AS ends_on,
            to_char(l.rewards_until, 'YYYY-MM-DD') AS rewards_until
       FROM poi_lists l
      WHERE l.status = 'published'
        AND ($1::date BETWEEN l.starts_on AND l.ends_on OR l.id = ANY($2::int[]))
      ORDER BY l.starts_on, l.id`,
    [onDate, ids]
  );
  if (listRows.rows.length === 0) return [];

  const itemRows = await pool.query(
    `SELECT i.id, i.list_id, i.poi_id, i.position, i.label, i.note, i.miles, i.rating, i.trail_class,
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

  return listRows.rows.map(list => ({ ...list, items: itemsByList.get(list.id) || [] }));
}

/**
 * Published lists whose season includes a given day, each with its items in order.
 * An item whose POI has been deleted is left out.
 *
 * @param {import('pg').Pool} pool
 * @param {string} [onDate] ISO date to ask about; defaults to today in the valley
 * @returns {Promise<object[]>} Lists with their `items`, earliest season first
 */
export function getActiveLists(pool, onDate = todayInValley()) {
  return loadLists(pool, onDate, null);
}

/**
 * Published lists by id, in or out of season: a badge earned in an earlier
 * year still needs its list.
 *
 * @param {import('pg').Pool} pool
 * @param {number[]} ids
 * @returns {Promise<object[]>}
 */
export function getListsByIds(pool, ids) {
  if (ids.length === 0) return Promise.resolve([]);
  return loadLists(pool, null, ids);
}

/**
 * Why the list's rules refuse a check-in, or null when they allow it. The
 * rules: the hike is on the list (or is the list's one free choice), and its
 * date is inside the season and not in the future.
 *
 * @param {{starts_on: string, ends_on: string, choice_label: string|null, items: {id: number}[]}} list
 * @param {{item_id: number|null, poi_id?: number|null, done_on: string}} checkin
 * @param {string} today ISO date
 * @returns {string|null}
 */
export function checkinProblem(list, checkin, today) {
  const doneOn = checkin.done_on;
  if (typeof doneOn !== 'string' || !ISO_DATE.test(doneOn) || Number.isNaN(Date.parse(doneOn))) {
    return 'A check-in needs the date it was done.';
  }
  if (doneOn < list.starts_on || doneOn > list.ends_on) {
    return `Only ${list.starts_on} through ${list.ends_on} counts for this list.`;
  }
  if (doneOn > today) return 'That date has not happened yet.';

  if (checkin.item_id == null) {
    if (!list.choice_label) return 'This list has no free choice.';
    if (!Number.isInteger(checkin.poi_id) || checkin.poi_id <= 0) return 'Pick the trail you chose.';
    return null;
  }
  return list.items.some(item => item.id === checkin.item_id) ? null : 'That is not on this list.';
}

const normalizeCheckin = (raw) => ({
  item_id: raw?.item_id == null ? null : Number(raw.item_id),
  poi_id: raw?.poi_id == null ? null : Number(raw.poi_id),
  done_on: raw?.done_on
});

// Which of these POIs are trails that still exist: the free choice must be one.
async function liveTrailIds(pool, poiIds) {
  if (poiIds.length === 0) return new Set();
  const trails = await pool.query(
    `SELECT id FROM pois WHERE id = ANY($1::int[]) AND deleted IS NOT TRUE AND 'trail' = ANY(poi_roles)`,
    [poiIds]
  );
  return new Set(trails.rows.map(row => row.id));
}

const poiOfCheckin = (list, checkin) => (checkin.item_id == null
  ? checkin.poi_id
  : list.items.find(item => item.id === checkin.item_id).poi_id);

/**
 * Log, or re-date, one check-in for a user.
 *
 * @param {import('pg').Pool} pool
 * @param {number} userId
 * @param {number} listId
 * @param {object} rawCheckin `{ item_id, poi_id, done_on }`; `item_id` null is the free choice
 * @param {string} [today] ISO date; defaults to today in the valley
 * @returns {Promise<{list_id: number, item_id: number|null, poi_id: number, done_on: string}>}
 * @throws {CheckinError} when the list is unknown or its rules refuse the check-in
 */
export async function saveCheckin(pool, userId, listId, rawCheckin, today = todayInValley()) {
  const [list] = await getListsByIds(pool, [listId]);
  if (!list) throw new CheckinError('List not found.', 404);

  const checkin = normalizeCheckin(rawCheckin);
  const problem = checkinProblem(list, checkin, today);
  if (problem) throw new CheckinError(problem);
  if (checkin.item_id == null && !(await liveTrailIds(pool, [checkin.poi_id])).has(checkin.poi_id)) {
    throw new CheckinError('Pick a trail for your free choice.');
  }

  const poiId = poiOfCheckin(list, checkin);
  const redated = await pool.query(
    `UPDATE user_list_checkins SET done_on = $4::date, poi_id = $5
      WHERE user_id = $1 AND list_id = $2 AND item_id IS NOT DISTINCT FROM $3::int`,
    [userId, list.id, checkin.item_id, checkin.done_on, poiId]
  );
  if (redated.rowCount === 0) {
    // Two taps at once: the unique indexes keep one, and it is this same hike.
    await pool.query(
      `INSERT INTO user_list_checkins (user_id, list_id, item_id, poi_id, done_on)
       VALUES ($1, $2, $3, $4, $5::date)
       ON CONFLICT DO NOTHING`,
      [userId, list.id, checkin.item_id, poiId, checkin.done_on]
    );
  }
  return { list_id: list.id, item_id: checkin.item_id, poi_id: poiId, done_on: checkin.done_on };
}

/**
 * Remove one check-in. `itemId` null removes the free choice.
 * @returns {Promise<boolean>} whether a row was removed
 */
export async function removeCheckin(pool, userId, listId, itemId) {
  const removed = await pool.query(
    `DELETE FROM user_list_checkins
      WHERE user_id = $1 AND list_id = $2 AND item_id IS NOT DISTINCT FROM $3::int`,
    [userId, listId, itemId]
  );
  return removed.rowCount > 0;
}

/** Every check-in a user has logged, on any list, oldest first. */
export async function getUserCheckins(pool, userId) {
  const checkins = await pool.query(
    `SELECT list_id, item_id, poi_id, to_char(done_on, 'YYYY-MM-DD') AS done_on
       FROM user_list_checkins
      WHERE user_id = $1
      ORDER BY done_on, id`,
    [userId]
  );
  return checkins.rows;
}

/**
 * Fold check-ins a device logged while signed out into the account. Server
 * wins: a check-in the account already has keeps its date, and one the rules
 * refuse is dropped.
 *
 * @param {import('pg').Pool} pool
 * @param {number} userId The account to add them to
 * @param {{list_id: number, item_id: number|null, poi_id?: number|null, done_on: string}[]} rawCheckins
 *   What the device held, untrusted: `item_id` null is the list's free choice and `poi_id` then the
 *   trail chosen; `done_on` is an ISO date. Anything else, and anything past the first 200, is ignored.
 * @param {string} [today] ISO date (YYYY-MM-DD) the rules are judged against; defaults to today in the valley
 * @returns {Promise<number>} how many were added
 */
export async function syncCheckins(pool, userId, rawCheckins, today = todayInValley()) {
  if (!Array.isArray(rawCheckins) || rawCheckins.length === 0) return 0;
  const wanted = rawCheckins.slice(0, MAX_SYNC_CHECKINS)
    .map(raw => ({ listId: Number(raw?.list_id), checkin: normalizeCheckin(raw) }))
    .filter(({ listId }) => Number.isInteger(listId) && listId > 0);
  const lists = new Map((await getListsByIds(pool, [...new Set(wanted.map(w => w.listId))])).map(l => [l.id, l]));

  const allowed = wanted.filter(({ listId, checkin }) =>
    lists.has(listId) && !checkinProblem(lists.get(listId), checkin, today));
  const trails = await liveTrailIds(pool, allowed.filter(w => w.checkin.item_id == null).map(w => w.checkin.poi_id));
  const rows = allowed.filter(({ checkin }) => checkin.item_id != null || trails.has(checkin.poi_id));
  if (rows.length === 0) return 0;

  const added = await pool.query(
    `INSERT INTO user_list_checkins (user_id, list_id, item_id, poi_id, done_on)
     SELECT $1::int, held.list_id, held.item_id, held.poi_id, held.done_on
       FROM UNNEST($2::int[], $3::int[], $4::int[], $5::date[]) AS held(list_id, item_id, poi_id, done_on)
     ON CONFLICT DO NOTHING`,
    [
      userId,
      rows.map(r => r.listId),
      rows.map(r => r.checkin.item_id),
      rows.map(r => poiOfCheckin(lists.get(r.listId), r.checkin)),
      rows.map(r => r.checkin.done_on)
    ]
  );
  return added.rowCount;
}
