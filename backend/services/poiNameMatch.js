/**
 * POI name matching — finds the POIs an article names outright.
 *
 * Collection files an item under whichever POI's search returned it, so a story
 * headlined "Akron Zoo opens public trail to John Brown Monument" can land on a
 * neighbor (John Brown House) or an unrelated POI (University of Akron Trailhead).
 * The POI gate uses these matches as reassignment candidates (issue #713).
 */

// Single-word names ("Akron") are too generic to trust as a match.
const MIN_NAME_LENGTH = 8;

/**
 * Normalize text for whole-word phrase matching.
 *
 * Lowercases, strips accents, drops a possessive "'s" ("Akron Zoo's" -> "akron zoo")
 * and any other apostrophe ("O'Neil" -> "oneil"), and turns every remaining run of
 * non-alphanumerics into one space. Titles and POI names go through the same steps,
 * so a possessive in a POI's own name still matches.
 *
 * @param {string|null|undefined} text
 * @returns {string} normalized text, empty for null/undefined
 */
export function normalizeForMatch(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019`]s\b/g, '')
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const normalizeName = (name) => normalizeForMatch(name).replace(/^the /, '');

/**
 * POIs named in an item's title or summary, best match first.
 *
 * Longer names claim their text first, so a shorter name only counts where it stands
 * apart from them: "John Brown" loses to "John Brown Monument" unless it also appears
 * on its own. Title matches rank ahead of summary-only matches, then longer names ahead
 * of shorter ones.
 *
 * @param {{title: string, description?: string}} item
 * @param {Array<{id: number, name: string, norm?: string}>} pois - norm is the
 *   pre-normalized name, when the caller has it cached
 * @param {{excludeIds?: Set<number>, limit?: number}} [options]
 * @returns {Array<{id: number, name: string}>}
 */
export function findNamedPois({ title, description }, pois, { excludeIds = new Set(), limit = 3 } = {}) {
  let remainingTitle = ` ${normalizeForMatch(title)} `;
  let remainingSummary = ` ${normalizeForMatch(description)} `;

  // Two POIs can share a name (a park's point and its boundary); keep the lowest id.
  const byName = new Map();
  for (const poi of pois) {
    if (excludeIds.has(poi.id)) continue;
    const name = poi.norm ?? normalizeName(poi.name);
    if (name.length < MIN_NAME_LENGTH || !name.includes(' ')) continue;
    if (!remainingTitle.includes(` ${name} `) && !remainingSummary.includes(` ${name} `)) continue;
    const existing = byName.get(name);
    if (!existing || poi.id < existing.id) byName.set(name, poi);
  }

  const matches = [];
  const longestFirst = [...byName.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [name, poi] of longestFirst) {
    const phrase = ` ${name} `;
    const inTitle = remainingTitle.includes(phrase);
    if (!inTitle && !remainingSummary.includes(phrase)) continue;
    // "|" never survives normalization, so a claimed span can't match a later name.
    remainingTitle = remainingTitle.replaceAll(phrase, ' | ');
    remainingSummary = remainingSummary.replaceAll(phrase, ' | ');
    matches.push({ poi, name, inTitle });
  }

  return matches
    .sort((a, b) => (b.inTitle - a.inTitle) || (b.name.length - a.name.length) || (a.poi.id - b.poi.id))
    .slice(0, limit)
    .map(m => ({ id: m.poi.id, name: m.poi.name }));
}

// A moderation sweep gates items one at a time; the POI list, with its normalized names,
// is the same for all of them.
const POI_NAMES_TTL_MS = 60_000;
let poiNamesCache = { rows: null, loadedAt: 0 };

/**
 * The active POIs an item names, best match first. The POI list is cached for a minute,
 * so a POI renamed or deleted mid-sweep is picked up on the next one. The app has one
 * pool, so the cache isn't keyed by it.
 *
 * @param {Pool} pool - Database connection pool
 * @param {{title: string, description?: string}} item
 * @param {{excludeIds?: Set<number>, limit?: number}} [options] - see findNamedPois
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function getNamedPoiCandidates(pool, item, options = {}) {
  if (!poiNamesCache.rows || Date.now() - poiNamesCache.loadedAt >= POI_NAMES_TTL_MS) {
    const poiRows = await pool.query(
      `SELECT id, name FROM pois WHERE (deleted IS NULL OR deleted = FALSE) AND name IS NOT NULL`
    );
    const rows = poiRows.rows.map(poi => ({ id: poi.id, name: poi.name, norm: normalizeName(poi.name) }));
    poiNamesCache = { rows, loadedAt: Date.now() };
  }
  return findNamedPois(item, poiNamesCache.rows, options);
}
