/**
 * Trail lines from Summit Metro Parks' own public layer (#778).
 *
 * Many of the district's trails were drawn without the stretches they share
 * with a neighbour, so they stop short of the loop a hiker walks (migration 103
 * fixed the spree's seven by hand). The district publishes one complete line per
 * named trail in "SMP Trails by Name"; this replaces a trail's line with the
 * district's when the two are the same trail and ours is clearly short of it.
 *
 * "The same trail" is the name and the ground: same name with any "(Park)"
 * suffix dropped, and nearly every point of our line lies on theirs. That keeps
 * the National Park's Ledges Trail away from Liberty Park's, and each Parcours
 * Trail with its own park.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('SmpTrailShapes');

const SMP_TRAILS_URL = 'https://services5.arcgis.com/gT94nvwhVWBDFu7Q/ArcGIS/rest/services/SMP_Trails_by_Name/FeatureServer/0/query';
export const SYNCED_SETTING = 'smp_trail_shapes_synced_at';

// Ours is replaced only when it is under this share of the district's length.
const SHORT_RATIO = 0.9;
// A point of our line within this many metres of theirs is on it...
const NEAR_METERS = 60;
// ...and this share of our points must be, for the two to be one trail.
const ON_LINE_SHARE = 0.9;
const MAX_SAMPLES = 300;
const EARTH_METERS = 6371008.8;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** A trail name compared without case, punctuation or a "(Park)" suffix. */
export function normalizeName(name) {
  return (name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
}

function lines(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function meters(a, b) {
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_METERS * Math.asin(Math.sqrt(h));
}

/** Length of a LineString or MultiLineString, in miles. */
export function lineMiles(geometry) {
  let total = 0;
  for (const line of lines(geometry)) {
    for (let i = 1; i < line.length; i++) total += meters(line[i - 1], line[i]);
  }
  return total / 1609.344;
}

/**
 * The share of one line's points that lie on another.
 *
 * @param {object} ours GeoJSON line whose points are tested
 * @param {object} theirs GeoJSON line they are tested against
 * @param {number} [within=NEAR_METERS] Metres from `theirs` that count as on it
 * @returns {number} 0 to 1
 */
export function shareOnLine(ours, theirs, within = NEAR_METERS) {
  const points = lines(ours).flat();
  const segments = lines(theirs).flatMap(line => line.slice(1).map((point, i) => [line[i], point]));
  if (points.length === 0 || segments.length === 0) return 0;
  const step = Math.max(1, Math.ceil(points.length / MAX_SAMPLES));
  let tested = 0, near = 0;
  for (let i = 0; i < points.length; i += step) {
    tested++;
    const point = points[i];
    // Distance to each segment on a flat local projection, which is close enough at trail scale
    const squash = Math.cos(toRadians(point[1]));
    const onLine = segments.some(([a, b]) => {
      const dx = (b[0] - a[0]) * squash, dy = b[1] - a[1];
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq ? Math.max(0, Math.min(1, ((point[0] - a[0]) * squash * dx + (point[1] - a[1]) * dy) / lengthSq)) : 0;
      return meters(point, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) <= within;
    });
    if (onLine) near++;
  }
  return near / tested;
}

/**
 * Which of our trails to redraw from the district's lines.
 *
 * @param {{id: number, name: string, geometry: object}[]} trails Our trails
 * @param {{properties: {NAME: string, PARK?: string, MILES?: number}, geometry: object}[]} features The district's
 * @returns {{updates: object[], missing: string[]}} `updates` carries each trail's id, name,
 *   old and new miles, the district's name and its geometry; `missing` names district
 *   trails we have no line for
 */
export function planShapeUpdates(trails, features) {
  const updates = [];
  const missing = [];
  for (const feature of features) {
    const theirs = feature.geometry;
    const theirMiles = lineMiles(theirs);
    if (!theirs || theirMiles === 0) continue;
    const name = (feature.properties?.NAME || '').trim();
    const sameName = trails.filter(trail => normalizeName(trail.name) === normalizeName(name));
    const onGround = sameName.filter(trail => shareOnLine(trail.geometry, theirs) >= ON_LINE_SHARE);
    if (onGround.length === 0) {
      missing.push(name);
      continue;
    }
    for (const trail of onGround) {
      const ourMiles = lineMiles(trail.geometry);
      if (ourMiles < theirMiles * SHORT_RATIO && !updates.some(update => update.id === trail.id)) {
        updates.push({ id: trail.id, name: trail.name, districtName: name, fromMiles: ourMiles, toMiles: theirMiles, geometry: theirs });
      }
    }
  }
  return { updates, missing };
}

/**
 * Every named trail in the district's layer, as GeoJSON in WGS 84.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object[]>} GeoJSON features
 */
export async function fetchDistrictTrails(fetchImpl = fetch) {
  const params = new URLSearchParams({
    where: '1=1', outFields: 'NAME,PARK,MILES', returnGeometry: 'true',
    outSR: '4326', geometryPrecision: '6', f: 'geojson'
  });
  const response = await fetchImpl(`${SMP_TRAILS_URL}?${params}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`SMP Trails by Name answered HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.features)) throw new Error('SMP Trails by Name returned no features');
  if (body.exceededTransferLimit || body.properties?.exceededTransferLimit) {
    throw new Error('SMP Trails by Name returned only part of the layer');
  }
  return body.features;
}

/**
 * Redraw our short trails from the district's lines. A trail edited since it
 * was read is left alone.
 *
 * @param {import('pg').Pool} pool
 * @param {{fetchImpl?: typeof fetch, dryRun?: boolean}} [options]
 * @returns {Promise<{updated: object[], missing: string[]}>} `updated` without geometries
 */
export async function syncTrailShapes(pool, { fetchImpl = fetch, dryRun = false } = {}) {
  const features = await fetchDistrictTrails(fetchImpl);
  const { rows: trails } = await pool.query(
    `SELECT id, name, geometry FROM pois
      WHERE 'trail' = ANY(poi_roles) AND deleted IS NOT TRUE AND geometry IS NOT NULL`
  );
  const { updates, missing } = planShapeUpdates(trails, features);

  const updated = [];
  for (const { geometry, ...update } of updates) {
    const before = trails.find(trail => trail.id === update.id).geometry;
    if (!dryRun) {
      const result = await pool.query(
        `UPDATE pois SET geometry = $2::jsonb, updated_at = NOW()
          WHERE id = $1 AND geometry = $3::jsonb`,
        [update.id, JSON.stringify(geometry), JSON.stringify(before)]
      );
      if (result.rowCount === 0) continue;
    }
    updated.push({ ...update, fromMiles: +update.fromMiles.toFixed(2), toMiles: +update.toMiles.toFixed(2) });
  }

  if (!dryRun) {
    await pool.query(
      `INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [SYNCED_SETTING, new Date().toISOString()]
    );
  }
  logger.info(`Trail shapes: ${updated.length} redrawn from Summit Metro Parks${dryRun ? ' (dry run)' : ''}; ${missing.length} district trails not on the map`);
  return { updated, missing };
}
