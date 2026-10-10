/**
 * POI merge - fold a duplicate point POI into the park boundary it describes.
 *
 * A park is one POI carrying the 'boundary' role (spec 048). Production grew
 * pairs: a content-less boundary plus a point holding the description, news,
 * events and photos. mergePois() moves everything onto the boundary and
 * retires the point; findParkMergeCandidates() lists the pairs for review.
 *
 * Also owns the name guard that stops new duplicates being created.
 */

import { createLogger } from '../utils/logger.js';
import { loadListSetting } from './filterLists.js';
import imageServerClient from './imageServerClient.js';

const logger = createLogger('PoiMerge');

const COUNTIES = 'summit|cuyahoga|portage|medina|stark|geauga|lake';
const COUNTY_SUFFIX_RE = new RegExp(`\\s+(?:${COUNTIES})\\s+county\\s*$`, 'i');
const MERGED_SUFFIX_RE = / \[merged into #\d+\]$/;

// How far outside its polygon a park's own point may sit (a lot on the edge).
const PARK_POINT_TOLERANCE_M = 1000;

/**
 * Name as people mean it: case, apostrophe style and a trailing county dropped.
 * The SQL twin is the poi_name_key() function created in server.js initDatabase;
 * the integration test holds the two to the same answers.
 *
 * @param {string|null|undefined} name - A POI name as stored or typed
 * @returns {string} Lowercase comparison key; '' for an empty name
 */
export function normalizePoiName(name) {
  return String(name || '')
    .replace(/[‘’]/g, "'")
    .replace(COUNTY_SUFFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The name a retired POI carried before mergePois() suffixed it.
 * @param {string} name - Stored name, with or without the merged suffix
 * @returns {string}
 */
export function originalMergedName(name) {
  return String(name || '').replace(MERGED_SUFFIX_RE, '');
}

/**
 * Raised by mergePois() when the pair is not a live point being folded into a
 * live park boundary. `status` is the HTTP status a route should answer with (400).
 */
export class PoiMergeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PoiMergeError';
    this.status = 400;
  }
}

/**
 * Raised by assertPoiNameAvailable() when another live POI answers to the name.
 * `status` is the HTTP status a route should answer with (409); `existing` is
 * the POI that holds the name, as `{ id: number, name: string }`.
 */
export class PoiNameConflictError extends Error {
  /**
   * @param {string} name - The name that was asked for
   * @param {{id: number, name: string}} existing - The POI that already has it
   */
  constructor(name, existing) {
    super(`A place named "${existing.name}" already exists (#${existing.id}). Edit that one instead of creating "${name}".`);
    this.name = 'PoiNameConflictError';
    this.status = 409;
    this.existing = existing;
  }
}

/**
 * Throw PoiNameConflictError when another live POI already answers to this
 * name. Pass `id` when editing so a POI never conflicts with itself, and
 * `currentName` so an edit that leaves the name alone is never blocked by a
 * duplicate that predates the guard.
 *
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {object} poi
 * @param {string} poi.name - The name being created or saved
 * @param {number|null} [poi.id] - The POI being edited; null when creating
 * @param {string|null} [poi.currentName] - Its stored name; null when creating
 * @returns {Promise<void>} Resolves when the name is free
 * @throws {PoiNameConflictError} when another live POI answers to the name
 */
export async function assertPoiNameAvailable(pool, { name, id = null, currentName = null }) {
  const normalized = normalizePoiName(name);
  if (!normalized) return;
  if (currentName !== null && normalizePoiName(currentName) === normalized) return;

  const clash = await pool.query(
    `SELECT id, name FROM pois
      WHERE deleted IS NOT TRUE
        AND ($2::int IS NULL OR id <> $2)
        AND poi_name_key(name) = $1
      ORDER BY id LIMIT 1`,
    [normalized, id]
  );
  if (clash.rows.length > 0) throw new PoiNameConflictError(name, clash.rows[0]);
}

/**
 * The message for a pois_name_key violation, or null for any other error.
 * assertPoiNameAvailable() ignores soft-deleted rows but the unique index does
 * not, so a name a deleted POI still holds passes the guard and fails here.
 *
 * @param {Error & {code?: string, constraint?: string}} err - A pg query error
 * @param {string} name - The name that was being written
 * @returns {string|null}
 */
export function poiNameIndexConflict(err, name) {
  if (err?.code !== '23505' || err?.constraint !== 'pois_name_key') return null;
  return `A POI named "${name}" already exists, possibly deleted. Restore or rename that one instead.`;
}

/**
 * Park boundaries that have a separate point POI of the same name within
 * PARK_POINT_TOLERANCE_M of the park.
 *
 * @param {import('pg').Pool} pool - Database connection pool
 * @returns {Promise<Array<{park_id: number, park_name: string, point_id: number, point_name: string}>>}
 *   One row per pair, ordered by park name; pass point_id and park_id to mergePois().
 */
export async function findParkMergeCandidates(pool) {
  const pairs = await pool.query(`
    SELECT b.id AS park_id, b.name AS park_name, p.id AS point_id, p.name AS point_name
      FROM pois b
      JOIN pois p
        ON p.id <> b.id
       AND p.deleted IS NOT TRUE
       AND p.merged_into_id IS NULL
       AND p.poi_roles = ARRAY['point']::text[]
       AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
       AND poi_name_key(p.name) = poi_name_key(b.name)
       AND ST_DWithin(
             b.boundary_geom::geography,
             ST_SetSRID(ST_MakePoint(p.longitude::float8, p.latitude::float8), 4326)::geography,
             $1)
     WHERE 'boundary' = ANY(b.poi_roles) AND b.boundary_type = 'park'
       AND b.deleted IS NOT TRUE
       AND b.boundary_geom IS NOT NULL
     ORDER BY b.name, p.id
  `, [PARK_POINT_TOLERANCE_M]);
  return pairs.rows;
}

// Winner keeps its own value; the loser's fills a NULL or empty one.
const FILL_COLUMNS = [
  'brief_description', 'historical_description', 'era_id', 'primary_activities',
  'surface', 'pets', 'cell_signal', 'more_info_link', 'opening_hours', 'wheelchair',
  'fee', 'property_owner', 'owner_id', 'news_url', 'events_url', 'status_url',
  'research_context', 'length_miles', 'difficulty', 'live_tracker_url'
];

// Columns with a default. A boundary nobody has filled in only holds the
// default, so the loser's real value wins; a park that already has content of
// its own keeps its settings.
const LOSER_WINS_COLUMNS = [
  'collection_tier', 'has_parking', 'has_restrooms', 'is_seasonal',
  'is_ada_accessible', 'is_bike_friendly', 'news_score_threshold',
  'events_score_threshold', 'last_current_news_collection',
  'last_historical_collection', 'last_news_collection', 'history_dry_runs',
  'history_query_index'
];

// The winner as imported: an outline with nothing written on it yet.
const WINNER_IS_BLANK = `(NULLIF(w.brief_description, '') IS NULL
  AND NULLIF(w.news_url, '') IS NULL AND NULLIF(w.events_url, '') IS NULL)`;

// [table, column] pairs repointed with a plain UPDATE.
const PLAIN_REPOINTS = [
  ['poi_news', 'poi_id'],
  ['poi_events', 'poi_id'],
  ['poi_events', 'venue_poi_id'],
  ['poi_event_series', 'poi_id'],
  ['poi_event_series', 'venue_poi_id'],
  ['trail_status', 'poi_id'],
  ['trip_stops', 'poi_id'],
  ['river_gauges', 'river_poi_id'],
  ['photo_submissions', 'poi_id'],
  ['poi_newsletter_sources', 'poi_id'],
  ['poi_list_items', 'poi_id'],
  ['pois', 'owner_id']
];

// [table, poi column, other key column]: the pair is unique, so a row the
// winner already has is dropped from the loser instead of moved.
const COLLIDING_REPOINTS = [
  ['user_poi_favorites', 'poi_id', 'user_id'],
  ['user_visits', 'poi_id', 'user_id'],
  ['poi_associations', 'physical_poi_id', 'virtual_poi_id'],
  ['poi_associations', 'virtual_poi_id', 'physical_poi_id']
];

async function existingColumns(client, table) {
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  return new Set(cols.rows.map(r => r.column_name));
}

async function loadPair(client, loserId, winnerId) {
  const found = await client.query(
    `SELECT id, name, poi_roles, boundary_type, deleted, merged_into_id, osm_id,
            latitude, longitude, has_primary_image,
            geometry IS NOT NULL AS has_geometry,
            boundary_geom IS NOT NULL AS has_boundary_geom
       FROM pois WHERE id = ANY($1) FOR UPDATE`,
    [[loserId, winnerId]]
  );
  const byId = new Map(found.rows.map(r => [r.id, r]));
  return { loser: byId.get(loserId), winner: byId.get(winnerId) };
}

function assertMergeable(loser, winner, loserId, winnerId) {
  const fail = (msg) => { throw new PoiMergeError(msg); };
  if (loserId === winnerId) fail('A POI cannot be merged into itself.');
  if (!loser) fail(`POI #${loserId} not found.`);
  if (!winner) fail(`POI #${winnerId} not found.`);
  if (winner.deleted) fail(`Winner #${winnerId} is deleted.`);
  if (!(winner.poi_roles || []).includes('boundary') || winner.boundary_type !== 'park' || !winner.has_boundary_geom) {
    fail(`Winner #${winnerId} must be a park boundary with geometry.`);
  }
  if (loser.merged_into_id) fail(`POI #${loserId} was already merged into #${loser.merged_into_id}.`);
  if (loser.deleted) fail(`Loser #${loserId} is deleted.`);
  const loserRoles = loser.poi_roles || [];
  if (loserRoles.length !== 1 || loserRoles[0] !== 'point' || loser.has_geometry) {
    fail(`Loser #${loserId} must be a plain point POI.`);
  }
  if (loser.latitude === null || loser.longitude === null) fail(`Loser #${loserId} has no coordinates.`);
}

async function copyContent(client, loserId, winnerId) {
  const cols = await existingColumns(client, 'pois');
  const sets = [
    ...FILL_COLUMNS.filter(c => cols.has(c))
      .map(c => `${c} = CASE WHEN NULLIF(w.${c}::text, '') IS NULL THEN l.${c} ELSE w.${c} END`),
    ...LOSER_WINS_COLUMNS.filter(c => cols.has(c))
      .map(c => `${c} = CASE WHEN ${WINNER_IS_BLANK} THEN COALESCE(l.${c}, w.${c}) ELSE w.${c} END`),
    'latitude = l.latitude',
    'longitude = l.longitude',
    // A boundary only gets a Directions button from the navigation pair.
    'navigation_latitude = COALESCE(l.navigation_latitude, l.latitude)',
    'navigation_longitude = COALESCE(l.navigation_longitude, l.longitude)',
    'updated_at = CURRENT_TIMESTAMP'
  ];
  await client.query(
    `UPDATE pois w SET ${sets.join(', ')} FROM pois l WHERE w.id = $1 AND l.id = $2`,
    [winnerId, loserId]
  );
}

// Older photos exist only in the image server, filed under the POI id they
// were uploaded for, with no poi_media row; the thumbnail route finds them by
// asking the image server for that id. The image server cannot refile an
// asset, so the park gets a poi_media row pointing at each one instead.
async function adoptImageServerAssets(client, assets, winnerId, counts) {
  const adoptable = assets.filter(a => a.role === 'primary' || a.role === 'gallery');
  if (adoptable.length === 0) return;
  // One statement for all of them. At most one becomes the park's primary, and
  // only when the park has none: the first primary by asset id.
  const inserted = await client.query(
    `INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, moderation_status)
     SELECT $1::int, a.media_type, a.asset_id,
            CASE WHEN a.role = 'primary'
                  AND row_number() OVER (PARTITION BY a.role ORDER BY a.asset_id) = 1
                  AND NOT EXISTS (SELECT 1 FROM poi_media WHERE poi_id = $1::int AND role = 'primary')
                 THEN 'primary' ELSE 'gallery' END,
            'published'
       FROM unnest($2::text[], $3::text[], $4::text[]) AS a(asset_id, media_type, role)
      WHERE NOT EXISTS (SELECT 1 FROM poi_media m WHERE m.image_server_asset_id = a.asset_id)`,
    [
      winnerId,
      adoptable.map(a => String(a.id)),
      adoptable.map(a => (a.asset_type === 'video' ? 'video' : 'image')),
      adoptable.map(a => a.role)
    ]
  );
  counts.image_server_assets = inserted.rowCount;
}

// The loser's has_primary_image is not copied: production points carried the
// flag long after their photo was gone (#739). Once media and image-server
// assets have moved, the park's flag says whether the thumbnail route can
// serve it something, keeping a TRUE the park already had.
async function refreshPrimaryImageFlag(client, winnerId) {
  await client.query(
    `UPDATE pois SET has_primary_image = COALESCE(has_primary_image, FALSE) OR EXISTS (
        SELECT 1 FROM poi_media
         WHERE poi_id = $1
           AND role IN ('primary', 'gallery')
           AND media_type IN ('image', 'video')
           AND moderation_status IN ('published', 'auto_approved'))
      WHERE id = $1`,
    [winnerId]
  );
}

async function moveMedia(client, loserId, winnerId, counts) {
  // One published primary per POI (idx_poi_media_unique_primary): demote the
  // loser's before the rows change owner.
  await client.query(
    `UPDATE poi_media SET role = 'gallery'
      WHERE poi_id = $1 AND role = 'primary'
        AND EXISTS (SELECT 1 FROM poi_media WHERE poi_id = $2 AND role = 'primary')`,
    [loserId, winnerId]
  );
  const moved = await client.query('UPDATE poi_media SET poi_id = $2 WHERE poi_id = $1', [loserId, winnerId]);
  counts.poi_media = moved.rowCount;
}

async function repointReferences(client, loserId, winnerId, counts) {
  for (const [table, col, otherKey] of COLLIDING_REPOINTS) {
    await client.query(
      `DELETE FROM ${table} l WHERE l.${col} = $1
          AND EXISTS (SELECT 1 FROM ${table} w WHERE w.${col} = $2 AND w.${otherKey} = l.${otherKey})`,
      [loserId, winnerId]
    );
    const moved = await client.query(`UPDATE ${table} SET ${col} = $2 WHERE ${col} = $1`, [loserId, winnerId]);
    counts[`${table}.${col}`] = moved.rowCount;
  }
  // An association of the park with itself means nothing.
  await client.query(
    'DELETE FROM poi_associations WHERE virtual_poi_id = $1 AND physical_poi_id = $1',
    [winnerId]
  );

  for (const [table, col] of PLAIN_REPOINTS) {
    const moved = await client.query(`UPDATE ${table} SET ${col} = $2 WHERE ${col} = $1`, [loserId, winnerId]);
    counts[`${table}.${col}`] = moved.rowCount;
  }
}

async function repointLooseReferences(client, loserId, winnerId, counts) {
  // Route stops carry a poi_id inside JSONB (migration 083).
  const stops = await client.query(
    `UPDATE pois SET stops = (
        SELECT jsonb_agg(CASE WHEN (e.elem->>'poi_id') = $1::int::text
                              THEN e.elem || jsonb_build_object('poi_id', $2::int)
                              ELSE e.elem END ORDER BY e.ord)
          FROM jsonb_array_elements(stops) WITH ORDINALITY AS e(elem, ord))
      WHERE jsonb_typeof(stops) = 'array'
        AND stops @> jsonb_build_array(jsonb_build_object('poi_id', $1::int))`,
    [loserId, winnerId]
  );
  counts['pois.stops'] = stops.rowCount;

  const excluded = await loadListSetting(client, 'news_collection_excluded_pois');
  if (excluded.includes(loserId)) {
    const next = [...new Set(excluded.map(id => (id === loserId ? winnerId : id)))];
    await client.query(
      "UPDATE admin_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'news_collection_excluded_pois'",
      [JSON.stringify(next)]
    );
    counts['news_collection_excluded_pois'] = 1;
  }
}

async function retireLoser(client, loser, winner) {
  // osm_id is uniquely indexed: clear it on the loser before the winner takes it.
  await client.query('UPDATE pois SET osm_id = NULL WHERE id = $1', [loser.id]);
  if (loser.osm_id && !winner.osm_id) {
    await client.query('UPDATE pois SET osm_id = $2 WHERE id = $1', [winner.id, loser.osm_id]);
  }
  // The suffix frees the name, so the unique name index can build again.
  await client.query(
    `UPDATE pois SET deleted = TRUE, merged_into_id = $2::int,
            name = left(name, 220) || ' [merged into #' || $2::int::text || ']',
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [loser.id, winner.id]
  );
}

/**
 * Merge a point POI into a park boundary. One transaction; a dry run performs
 * the whole merge and rolls it back, so the reported counts are the real ones.
 *
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {number} loserId - Point POI to retire. Must be live, carry only the
 *   'point' role, have coordinates and no geometry, and not be merged already.
 * @param {number} winnerId - Park boundary that survives. Must be live, with
 *   boundary_type 'park' and a boundary_geom.
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Report what would move, change nothing.
 * @param {{getPoiAssets: function(number): Promise<object[]>}} [options.imageServer] -
 *   Source of the loser's image-server assets; defaults to the app's client.
 * @returns {Promise<{
 *   dryRun: boolean,
 *   loser: {id: number, name: string},
 *   winner: {id: number, name: string},
 *   moved: Object<string, number>
 * }>} `moved` maps "table.column" to rows repointed, omitting zeros. `loser.name`
 *   is the name before the merged suffix was added.
 * @throws {PoiMergeError} when the pair is not mergeable (see above).
 */
export async function mergePois(pool, loserId, winnerId, { dryRun = false, imageServer = imageServerClient } = {}) {
  // Read before the transaction opens: a network call should not hold row locks.
  const legacyAssets = await imageServer.getPoiAssets(loserId);
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    const { loser, winner } = await loadPair(client, loserId, winnerId);
    assertMergeable(loser, winner, loserId, winnerId);

    await copyContent(client, loserId, winnerId);
    await moveMedia(client, loserId, winnerId, counts);
    await adoptImageServerAssets(client, legacyAssets, winnerId, counts);
    await refreshPrimaryImageFlag(client, winnerId);
    await repointReferences(client, loserId, winnerId, counts);
    await repointLooseReferences(client, loserId, winnerId, counts);
    await retireLoser(client, loser, winner);

    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    if (!dryRun) logger.info(`Merged POI #${loserId} "${loser.name}" into #${winnerId} "${winner.name}"`);
    return {
      dryRun,
      loser: { id: loser.id, name: loser.name },
      winner: { id: winner.id, name: winner.name },
      moved: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0))
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(rollbackErr => {
      logger.error(`Rollback failed while merging #${loserId} into #${winnerId}:`, rollbackErr);
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Follow merged_into_id for a list of POI ids.
 *
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {number[]} ids - POI ids a client holds
 * @returns {Promise<Map<number, number>>} Retired id to the id it was merged
 *   into; ids that were never merged are absent
 */
export async function resolveMergedIds(pool, ids) {
  if (!ids || ids.length === 0) return new Map();
  const merged = await pool.query(
    'SELECT id, merged_into_id FROM pois WHERE id = ANY($1) AND merged_into_id IS NOT NULL',
    [ids]
  );
  return new Map(merged.rows.map(r => [r.id, r.merged_into_id]));
}
