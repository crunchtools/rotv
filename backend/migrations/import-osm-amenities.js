/**
 * Import OpenStreetMap playground & restroom amenities as point POIs (#418).
 *
 * Companion to 066_add_amenity_poi_types.sql (which adds the icon types, the
 * osm_id column, and the excluded-from-collection setting). This script loads the
 * committed snapshot in backend/data/osm/amenities.json — playgrounds
 * (leisure=playground) and restrooms (amenity=toilets) that fall inside a park
 * boundary, pre-filtered and assigned to their smallest containing park.
 *
 * Idempotent: upserts keyed on osm_id, so re-running (or re-deploying) never
 * duplicates POIs. Run after the SQL migrations:
 *
 *   node backend/migrations/import-osm-amenities.js      # local
 *   node /app/migrations/import-osm-amenities.js          # in container
 *
 * Refresh the snapshot by re-querying Overpass for the two tags in the region
 * bbox and re-filtering to boundary_type='park' polygons.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'rotv',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD
});

const KIND_META = {
  playground: { activity: 'Playground', label: 'Playground', blurb: 'Playground' },
  restroom: { activity: 'Restroom', label: 'Restroom', blurb: 'Public restroom' }
};

const snapshot = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'osm', 'amenities.json'), 'utf-8')
);

console.log(`Importing ${snapshot.length} OSM amenities...\n`);

// Tracks "<park> <Kind>" base-name usage so collisions get a stable numeric
// suffix; processing follows snapshot order, so names are reproducible.
const nameCounts = new Map();
let inserted = 0;
let updated = 0;
let skipped = 0;

for (const feature of snapshot) {
  const meta = KIND_META[feature.kind];
  if (!meta) {
    console.warn(`  SKIP ${feature.osm_id} — unknown kind '${feature.kind}'`);
    skipped++;
    continue;
  }

  // Display name: OSM name tag, else "<park> <Kind>" with a suffix on collision.
  let name = feature.osm_name;
  if (!name) {
    const base = `${feature.park} ${meta.label}`;
    const seen = (nameCounts.get(base) || 0) + 1;
    nameCounts.set(base, seen);
    name = seen === 1 ? base : `${base} ${seen}`;
  }

  const description = `${meta.blurb} in ${feature.park}.`;

  // node123 -> node/123, way45 -> way/45
  const osmMatch = /^([a-z]+?)s?(\d+)$/.exec(feature.osm_id);
  const moreInfoLink = osmMatch
    ? `https://www.openstreetmap.org/${osmMatch[1]}/${osmMatch[2]}`
    : null;

  try {
    const upsert = await pool.query(
      `INSERT INTO pois (
         name, poi_roles, latitude, longitude,
         geom, primary_activities, brief_description, collection_tier,
         osm_id, more_info_link, has_primary_image, created_at, updated_at
       )
       VALUES (
         $1, ARRAY['point']::text[], $2::double precision, $3::double precision,
         ST_SetSRID(ST_MakePoint($3::double precision, $2::double precision), 4326), $4, $5, 'monthly',
         $6, $7, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       ON CONFLICT (osm_id) WHERE osm_id IS NOT NULL DO UPDATE SET
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         geom = EXCLUDED.geom,
         primary_activities = EXCLUDED.primary_activities,
         updated_at = CURRENT_TIMESTAMP
       RETURNING (xmax = 0) AS is_insert`,  // xmax = 0 means a fresh INSERT; non-zero = ON CONFLICT UPDATE
      [name, feature.lat, feature.lon, meta.activity, description, feature.osm_id, moreInfoLink]
    );
    if (upsert.rows[0].is_insert) inserted++;
    else updated++;
  } catch (err) {
    console.error(`  ERROR ${feature.osm_id} (${name}) — ${err.message}`);
    skipped++;
  }
}

console.log(`\nDone. inserted=${inserted} updated=${updated} skipped=${skipped}`);
await pool.end();
