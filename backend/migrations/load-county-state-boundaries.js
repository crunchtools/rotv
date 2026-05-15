/**
 * Load county/state boundary GeoJSON into PostGIS geometry columns
 *
 * Companion to 044_add_county_state_boundaries.sql — that migration creates the
 * POI rows, this script loads the actual polygon data from the Census Bureau
 * GeoJSON files in backend/data/boundaries/.
 *
 * Run after the SQL migration:
 *   node backend/migrations/load-county-state-boundaries.js
 *
 * Or inside the container:
 *   node /app/migrations/load-county-state-boundaries.js
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

const boundaries = [
  { name: 'Cuyahoga County', file: 'cuyahoga-county.geojson' },
  { name: 'Summit County', file: 'summit-county.geojson' },
  { name: 'Ohio', file: 'ohio.geojson' },
  { name: 'Hampton Hills Mountain Bike Area', file: 'hampton-hills-mtb.geojson' },
];

console.log('Loading county/state boundary geometries...\n');

for (const boundary of boundaries) {
  try {
    const existing = await pool.query(
      "SELECT id, boundary_geom IS NOT NULL as has_geom FROM pois WHERE name = $1 AND 'boundary' = ANY(poi_roles)",
      [boundary.name]
    );

    if (!existing.rows.length) {
      console.log(`  SKIP ${boundary.name} — POI not found (run 044_add_county_state_boundaries.sql first)`);
      continue;
    }

    if (existing.rows[0].has_geom) {
      console.log(`  SKIP ${boundary.name} — geometry already loaded`);
      continue;
    }

    const dataDir = join(__dirname, '..', 'data', 'boundaries');
    const filePath = join(dataDir, boundary.file);
    const geojson = JSON.parse(readFileSync(filePath, 'utf-8'));

    if (!geojson.features || geojson.features.length === 0) {
      console.error(`  ERROR ${boundary.name} — GeoJSON file has no features`);
      continue;
    }

    const feature = geojson.features[0];
    const geometryJson = JSON.stringify(feature.geometry);

    await pool.query(`
      UPDATE pois
      SET geometry = $1::jsonb,
          boundary_geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
      WHERE id = $3
    `, [geometryJson, geometryJson, existing.rows[0].id]);

    console.log(`  OK   ${boundary.name} — geometry loaded (${(geometryJson.length / 1024).toFixed(0)}KB)`);
  } catch (err) {
    console.error(`  ERROR ${boundary.name} — ${err.message}`);
  }
}

const verify = await pool.query(`
  WITH poi_point AS (
    SELECT id, name, geom as point_geom
    FROM pois
    WHERE name = 'Liberty Park Nature Center' AND geom IS NOT NULL
    LIMIT 1
  )
  SELECT boundary.name
  FROM poi_point
  LEFT JOIN pois AS boundary
    ON 'boundary' = ANY(boundary.poi_roles)
    AND boundary.boundary_geom IS NOT NULL
    AND ST_Contains(boundary.boundary_geom, poi_point.point_geom)
  WHERE poi_point.point_geom IS NOT NULL
  ORDER BY ST_Area(boundary.boundary_geom) ASC
`);

if (verify.rows.length > 0) {
  const chain = verify.rows.map(r => r.name).join(', ');
  console.log(`\nVerification: Liberty Park Nature Center is now grounded in: ${chain}`);
} else {
  console.log('\nVerification: Liberty Park Nature Center not found or no grounding match');
}

console.log('\nDone.');
await pool.end();
