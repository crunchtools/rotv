/**
 * Generate the curated-POI -> OpenStreetMap match snapshot (#7).
 *
 * Matches ROTV's hand-curated POIs (parks, trails, visitor centers, businesses)
 * to OpenStreetMap features by name similarity + proximity, then records the
 * OSM id and any visitor-info tags (opening_hours / wheelchair / fee). The
 * result is written to backend/data/osm/poi-osm-matches.json, which is committed
 * and reviewable, and consumed by apply-osm-matches.js at deploy time.
 *
 * Companion to import-osm-amenities.js: that seeds amenity POIs *from* OSM; this
 * enriches POIs that already exist *with* OSM data.
 *
 * Run locally (needs internet for Overpass). It reads the POI list from a JSON
 * dump rather than the DB, so it has no pg dependency and stays reproducible:
 *
 *   # 1. Dump curated POIs (point lat/lon, else geometry centroid) from the DB:
 *   podman exec <container> psql -h localhost -U postgres -d rotv -tAc "
 *     SELECT json_agg(json_build_object('name',name,'lat',lat,'lon',lon)) FROM (
 *       SELECT name,
 *         COALESCE(latitude::float, ST_Y(ST_PointOnSurface(ST_GeomFromGeoJSON(geometry)))) lat,
 *         COALESCE(longitude::float, ST_X(ST_PointOnSurface(ST_GeomFromGeoJSON(geometry)))) lon
 *       FROM pois WHERE deleted IS NOT TRUE AND osm_id IS NULL
 *         AND (latitude IS NOT NULL OR geometry IS NOT NULL)
 *     ) s WHERE lat IS NOT NULL;" > /tmp/curated-pois.json
 *
 *   # 2. Generate the match snapshot:
 *   node backend/migrations/generate-osm-matches.js /tmp/curated-pois.json
 *
 * Matching is deliberately high-precision: name token similarity gates every
 * match, and the allowed distance scales with name confidence (a park or trail's
 * OSM centroid can sit a kilometre from the curated point). Proximity alone is
 * never enough — that is how a shoe store would otherwise inherit a neighbouring
 * cafe's hours.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'osm', 'poi-osm-matches.json');
const UA = 'rotv-osm-match/1.0 (rootsofthevalley.org)';
// CVNP region bbox (S,W,N,E). Clamped to the park region so the central-Ohio
// "Ohio" state-boundary POI does not pull half the state into the candidate set.
const BBOX = '41.00,-81.85,41.65,-81.10';

// Generic tokens that should not drive a match (every park has "park", etc.).
const STOP = new Set(['the', 'of', 'and', 'a', 'at', 'park', 'metropark', 'metro',
  'reservation', 'area', 'trail', 'trailhead', 'center', 'centre', 'national',
  'valley', 'cuyahoga', 'lot', 'parking']);

function tokens(name) {
  return new Set((name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(token => token && !STOP.has(token)));
}

function jaccard(nameA, nameB) {
  const setA = tokens(nameA), setB = tokens(nameB);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / (setA.size + setB.size - shared);
}

// True when one name's significant tokens are a subset of the other's, e.g.
// "Boston Store" vs "Boston Store Visitor Center".
function isContained(nameA, nameB) {
  const setA = tokens(nameA), setB = tokens(nameB);
  if (!setA.size || !setB.size) return false;
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const token of smaller) if (!larger.has(token)) return false;
  return true;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Allowed match radius grows with name confidence: an exact name match can be a
// large park whose centroid is far from the curated point; a weak name match
// must be nearly on top of the POI to count.
function maxDistance(similarity) {
  if (similarity >= 0.9) return 2000;
  if (similarity >= 0.7) return 800;
  if (similarity >= 0.55) return 300;
  return 0;
}

async function fetchCandidates() {
  const keys = ['leisure', 'tourism', 'historic', 'natural', 'boundary',
    'route', 'shop', 'amenity', 'landuse'];
  const parts = [];
  for (const t of ['node', 'way', 'relation'])
    for (const k of keys) parts.push(`${t}["name"]["${k}"](${BBOX});`);
  const ql = `[out:json][timeout:180];(${parts.join('')});out tags center;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(ql)
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const overpassResult = await res.json();

  const FEE = new Set(['yes', 'no', 'conditional']);
  const WC = new Set(['yes', 'limited', 'no', 'designated']);
  return overpassResult.elements.map(e => {
    const wc = (e.tags.wheelchair || '').toLowerCase();
    const fee = (e.tags.fee || '').toLowerCase();
    return {
      osm_id: `${e.type}${e.id}`,
      name: e.tags.name,
      lat: e.lat ?? e.center?.lat,
      lon: e.lon ?? e.center?.lon,
      opening_hours: e.tags.opening_hours || null,
      wheelchair: WC.has(wc) ? wc : null,
      fee: FEE.has(fee) ? fee : null
    };
  }).filter(c => c.lat && c.lon && c.name);
}

const poisPath = process.argv[2];
if (!poisPath) {
  console.error('Usage: node generate-osm-matches.js <curated-pois.json>');
  process.exit(1);
}

const pois = JSON.parse(readFileSync(poisPath, 'utf-8'));
console.log(`Loaded ${pois.length} curated POIs. Querying Overpass...`);
const candidates = await fetchCandidates();
console.log(`Fetched ${candidates.length} named OSM features in region.\n`);

const matches = [];
let enriched = 0;
for (const poi of pois) {
  let best = null;
  for (const c of candidates) {
    const j = jaccard(poi.name, c.name);
    const similarity = isContained(poi.name, c.name) ? Math.max(j, 0.85) : j;
    const limit = maxDistance(similarity);
    if (limit === 0) continue;
    const d = distanceMeters(poi.lat, poi.lon, c.lat, c.lon);
    if (d > limit) continue;
    const score = similarity - d / 5000;
    if (!best || score > best.score) best = { ...c, distance: d, similarity, score };
  }
  if (!best) continue;
  const hasTag = !!(best.opening_hours || best.wheelchair || best.fee);
  if (hasTag) enriched++;
  matches.push({
    poi_name: poi.name,
    osm_id: best.osm_id,
    opening_hours: best.opening_hours,
    wheelchair: best.wheelchair,
    fee: best.fee,
    match: {
      osm_name: best.name,
      similarity: Number(best.similarity.toFixed(2)),
      distance_m: Math.round(best.distance)
    }
  });
}

// Stable ordering (enriched first, then by name) keeps the committed file's
// diffs readable across regenerations.
matches.sort((a, b) => {
  const at = (a.opening_hours || a.wheelchair || a.fee) ? 0 : 1;
  const bt = (b.opening_hours || b.wheelchair || b.fee) ? 0 : 1;
  return at - bt || a.poi_name.localeCompare(b.poi_name);
});

writeFileSync(OUT, JSON.stringify(matches, null, 2) + '\n');
console.log(`Wrote ${matches.length} matches (${enriched} carry visitor-info tags) to`);
console.log(`  ${OUT}`);
