/**
 * The database side of duplicate detection: loading a match context. The
 * matchers themselves stay pure so they can run on fixtures and replays.
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
