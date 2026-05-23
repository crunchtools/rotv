/**
 * Load river/creek MultiLineString geometry into river-role POIs (#92)
 *
 * Companion to 061_add_river_gauges.sql — that migration creates the river POI rows
 * (Tinkers Creek, Brandywine Creek, Chippewa Creek, Indian Creek, Tuscarawas River);
 * this script loads their geometry from the OpenStreetMap-derived GeoJSON files in
 * backend/data/rivers/. Geometry lives in the pois.geometry JSONB column (the same
 * column the existing Cuyahoga River POI uses — the map renders linear features from it).
 *
 * Run after the SQL migration:
 *   node backend/migrations/load-river-geometry.js
 *
 * Or inside the container:
 *   node /app/migrations/load-river-geometry.js
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

const rivers = [
  { name: 'Tinkers Creek', file: 'tinkers-creek.geojson' },
  { name: 'Brandywine Creek', file: 'brandywine-creek.geojson' },
  { name: 'Chippewa Creek', file: 'chippewa-creek.geojson' },
  { name: 'Indian Creek', file: 'indian-creek.geojson' },
  { name: 'Tuscarawas River', file: 'tuscarawas-river.geojson' },
];

console.log('Loading river/creek geometries...\n');

for (const river of rivers) {
  try {
    const existing = await pool.query(
      "SELECT id, geometry IS NOT NULL as has_geom FROM pois WHERE name = $1 AND 'river' = ANY(poi_roles)",
      [river.name]
    );

    if (!existing.rows.length) {
      console.log(`  SKIP ${river.name} — POI not found (run 061_add_river_gauges.sql first)`);
      continue;
    }

    if (existing.rows[0].has_geom) {
      console.log(`  SKIP ${river.name} — geometry already loaded`);
      continue;
    }

    const filePath = join(__dirname, '..', 'data', 'rivers', river.file);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    // Files store a bare geometry object; tolerate a Feature/FeatureCollection too.
    const geometry = parsed.type === 'FeatureCollection' ? parsed.features[0].geometry
      : parsed.type === 'Feature' ? parsed.geometry
        : parsed;

    if (!geometry || !geometry.coordinates || geometry.coordinates.length === 0) {
      console.error(`  ERROR ${river.name} — GeoJSON has no coordinates`);
      continue;
    }

    const geometryJson = JSON.stringify(geometry);
    await pool.query(
      'UPDATE pois SET geometry = $1::jsonb WHERE id = $2',
      [geometryJson, existing.rows[0].id]
    );

    console.log(`  OK   ${river.name} — geometry loaded (${(geometryJson.length / 1024).toFixed(0)}KB)`);
  } catch (err) {
    console.error(`  ERROR ${river.name} — ${err.message}`);
  }
}

console.log('\nDone.');
await pool.end();
