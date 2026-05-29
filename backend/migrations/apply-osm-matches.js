/**
 * Apply the curated-POI -> OpenStreetMap match snapshot (#7).
 *
 * Reads backend/data/osm/poi-osm-matches.json (produced by generate-osm-matches.js)
 * and, for each matched POI, records the OSM id for provenance/future enrichment
 * and fills opening_hours / wheelchair / fee where OSM has them.
 *
 * Idempotent and non-destructive:
 *   - Visitor-info fields use COALESCE, so an admin-entered (or prior) value is
 *     never overwritten by OSM, and a re-run is a no-op.
 *   - osm_id is set on one row per matched name, only when that row has no osm_id
 *     yet AND the id is not already claimed (the column is uniquely indexed). A
 *     name shared by two POIs (e.g. a park's point and boundary) enriches both
 *     rows but assigns the osm_id to just one.
 *
 * Run after the SQL migrations and after import-osm-amenities.js:
 *
 *   node backend/migrations/apply-osm-matches.js      # local
 *   node /app/migrations/apply-osm-matches.js          # in container
 *
 * Refresh the snapshot with generate-osm-matches.js (see its header).
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

const matches = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'osm', 'poi-osm-matches.json'), 'utf-8')
);

console.log(`Applying ${matches.length} OSM matches...\n`);

let linked = 0;   // rows that gained an osm_id
let enriched = 0; // rows that gained at least one visitor-info value
let missing = 0;  // matched names with no POI in this database

for (const m of matches) {
  try {
    // Fill visitor-info on every row with this name; COALESCE preserves existing
    // values (admin edits, prior runs). more_info_link is intentionally left
    // alone so curated official links survive.
    const fill = await pool.query(
      `UPDATE pois SET
         opening_hours = COALESCE(opening_hours, $2),
         wheelchair    = COALESCE(wheelchair, $3),
         fee           = COALESCE(fee, $4),
         updated_at    = CURRENT_TIMESTAMP
       WHERE name = $1 AND deleted IS NOT TRUE`,
      [m.poi_name, m.opening_hours, m.wheelchair, m.fee]
    );
    if (fill.rowCount === 0) { missing++; continue; }
    if (m.opening_hours || m.wheelchair || m.fee) enriched += fill.rowCount;

    // Claim the osm_id on a single still-unlinked row, only if no other POI
    // already holds it (the column is uniquely indexed).
    const link = await pool.query(
      `UPDATE pois SET osm_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM pois
         WHERE name = $1 AND osm_id IS NULL AND deleted IS NOT TRUE
         ORDER BY id LIMIT 1
       )
       AND NOT EXISTS (SELECT 1 FROM pois WHERE osm_id = $2)`,
      [m.poi_name, m.osm_id]
    );
    linked += link.rowCount;
  } catch (err) {
    console.error(`  ERROR ${m.poi_name} (${m.osm_id}) — ${err.message}`);
  }
}

console.log(`\nDone. linked=${linked} enriched_rows=${enriched} missing=${missing}`);
await pool.end();
