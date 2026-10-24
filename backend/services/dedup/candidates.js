/**
 * The database side of duplicate detection: loading a match context and finding
 * candidate rows to compare. The matchers themselves stay pure so they can run
 * on fixtures and replays.
 */
import { createMatchContext } from './context.js';

const POI_NAMES_TTL_MS = 10 * 60 * 1000;
// Per pool, so a test's fake pool never sees another's names. A failed query
// caches nothing and the next call retries.
const poiNamesCache = new WeakMap();


/**
 * A match context with every POI name as a place word.
 * @param {import('pg').Pool} pool
 * @param {Omit<Parameters<typeof createMatchContext>[0], 'poiNames'> & {now?: number}} [options]
 *   thresholds and timezone; now (ms) for testing the cache
 * @returns {Promise<ReturnType<typeof createMatchContext>>}
 */
export async function loadMatchContext(pool, { now = Date.now(), ...options } = {}) {
  let cached = poiNamesCache.get(pool);
  if (!cached || now - cached.at >= POI_NAMES_TTL_MS) {
    const result = await pool.query('SELECT name FROM pois WHERE NOT COALESCE(deleted, false)');
    cached = { at: now, names: result.rows.map(r => r.name) };
    poiNamesCache.set(pool, cached);
  }
  return createMatchContext({ ...options, poiNames: cached.names });
}

// The SQL URL identity (see normalize.js); canonicalUrl refines it in memory
const SQL_URL_KEY = (column) => `LOWER(REGEXP_REPLACE(${column}, '/+$', ''))`;
const urlKey = (url) => (url ? url.toLowerCase().replace(/\/+$/, '') : null);
const CANDIDATE_LIMIT = 20;

/**
 * Published news that might be the same story as `item`, at any POI: a title
 * similar by trigram (pg_trgm's % operator, indexed by migration 011) or the
 * same URL, including the alternate URLs merged into a story. Rows carry the
 * fields newsPairMatch reads.
 * @param {import('pg').Pool} pool
 * @param {{id?: number, title: string, source_url?: string, publication_date?: string,
 *   collection_date?: string}} item
 * @param {{days?: number, statuses?: string[]}} [options] days: window around the item's date
 * @returns {Promise<object[]>}
 */
export async function findNewsCandidates(pool, item, { days = 14, statuses = ['published', 'auto_approved'] } = {}) {
  const result = await pool.query(`
    SELECT n.id, n.title, n.summary, n.source_url, n.source_name, n.publication_date, n.collection_date,
           n.moderation_status, p.id AS poi_id, p.name AS poi_name,
           (SELECT ARRAY_AGG(u.url) FROM poi_news_urls u WHERE u.news_id = n.id) AS alt_urls
    FROM poi_news n
    JOIN pois p ON p.id = n.poi_id
    WHERE n.id != COALESCE($1::int, -1)
      AND n.moderation_status = ANY($5::text[])
      AND COALESCE(n.publication_date, n.collection_date)
          BETWEEN COALESCE($4::timestamptz, NOW()) - make_interval(days => $6)
              AND COALESCE($4::timestamptz, NOW()) + make_interval(days => $6)
      AND (n.title % $2
           OR ${SQL_URL_KEY('n.source_url')} = $3
           OR EXISTS (SELECT 1 FROM poi_news_urls u WHERE u.news_id = n.id AND ${SQL_URL_KEY('u.url')} = $3))
    ORDER BY similarity(n.title, $2) DESC
    LIMIT ${CANDIDATE_LIMIT}`,
  [item.id ?? null, item.title || '', urlKey(item.source_url), item.publication_date || item.collection_date || null,
    statuses, days]);
  return result.rows;
}

/**
 * Published events within a day of `item` that might be the same event, at any
 * POI: a trigram-similar title or the same URL.
 * @param {import('pg').Pool} pool
 * @param {{id?: number, title: string, source_url?: string, start_date: string}} item
 * @param {{statuses?: string[]}} [options]
 * @returns {Promise<object[]>}
 */
export async function findEventCandidates(pool, item, { statuses = ['published', 'auto_approved'] } = {}) {
  if (!item.start_date) return [];
  const result = await pool.query(`
    SELECT e.id, e.title, e.description, e.start_date, e.location_details, e.source_url, e.venue_poi_id,
           e.moderation_status, p.id AS poi_id, p.name AS poi_name
    FROM poi_events e
    JOIN pois p ON p.id = e.poi_id
    WHERE e.id != COALESCE($1::int, -1)
      AND e.moderation_status = ANY($5::text[])
      AND e.start_date BETWEEN $4::timestamptz - INTERVAL '1 day' AND $4::timestamptz + INTERVAL '1 day'
      AND (e.title % $2 OR ${SQL_URL_KEY('e.source_url')} = $3)
    ORDER BY similarity(e.title, $2) DESC
    LIMIT ${CANDIDATE_LIMIT}`,
  [item.id ?? null, item.title || '', urlKey(item.source_url), item.start_date, statuses]);
  return result.rows;
}
