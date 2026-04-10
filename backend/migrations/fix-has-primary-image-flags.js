/**
 * Fix has_primary_image flags to match actual poi_media data
 *
 * Issue: 453 POIs have has_primary_image=true but only 53 actually have images
 * This script clears the flag for POIs without actual primary images
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'rotv',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD
});

async function main() {
  console.log('Fixing has_primary_image flags...\n');

  // Count POIs with stale flags
  const staleCount = await pool.query(`
    SELECT COUNT(*)
    FROM pois
    WHERE has_primary_image = true
      AND id NOT IN (
        SELECT DISTINCT poi_id
        FROM poi_media
        WHERE role = 'primary'
          AND moderation_status IN ('published', 'auto_approved')
      )
  `);

  console.log(`Found ${staleCount.rows[0].count} POIs with stale has_primary_image flags`);

  if (staleCount.rows[0].count > 0) {
    // Clear stale flags
    const result = await pool.query(`
      UPDATE pois
      SET has_primary_image = false
      WHERE has_primary_image = true
        AND id NOT IN (
          SELECT DISTINCT poi_id
          FROM poi_media
          WHERE role = 'primary'
            AND moderation_status IN ('published', 'auto_approved')
        )
    `);

    console.log(`✓ Cleared ${result.rowCount} stale flags\n`);
  }

  // Verify counts match
  const poisWithFlag = await pool.query('SELECT COUNT(*) FROM pois WHERE has_primary_image = true');
  const poisWithImage = await pool.query(`
    SELECT COUNT(DISTINCT poi_id)
    FROM poi_media
    WHERE role = 'primary'
      AND moderation_status IN ('published', 'auto_approved')
  `);

  console.log('=== Verification ===');
  console.log(`POIs with has_primary_image=true: ${poisWithFlag.rows[0].count}`);
  console.log(`POIs with actual primary images: ${poisWithImage.rows[0].count}`);
  console.log(`Match: ${poisWithFlag.rows[0].count === poisWithImage.rows[0].count ? '✓' : '✗'}`);

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  pool.end();
  process.exit(1);
});
