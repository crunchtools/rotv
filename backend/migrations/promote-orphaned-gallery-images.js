/**
 * Promote orphaned gallery images to primary
 *
 * Issue: 37 POIs have gallery images but no primary images (from Immich restore)
 * These POIs have has_primary_image=false but have a gallery image
 * Since there's only one image, promote it to primary
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
  console.log('Promoting orphaned gallery images to primary...\n');

  // Find POIs with gallery images but no primary images
  // Use DISTINCT ON to select only the first gallery image per POI (by created_at)
  const orphanedGallery = await pool.query(`
    SELECT DISTINCT ON (p.id)
           p.id, p.name, pm.id as media_id, pm.image_server_asset_id
    FROM pois p
    JOIN poi_media pm ON p.id = pm.poi_id
    WHERE p.has_primary_image = false
      AND pm.role = 'gallery'
      AND pm.moderation_status IN ('published', 'auto_approved')
      AND NOT EXISTS (
        SELECT 1 FROM poi_media pm2
        WHERE pm2.poi_id = p.id
          AND pm2.role = 'primary'
          AND pm2.moderation_status IN ('published', 'auto_approved')
      )
    ORDER BY p.id, pm.created_at ASC
  `);

  console.log(`Found ${orphanedGallery.rows.length} POIs with orphaned gallery images\n`);

  let promoted = 0;
  let flagged = 0;

  // Use transactions to ensure data consistency
  const client = await pool.connect();
  try {
    for (const row of orphanedGallery.rows) {
      await client.query('BEGIN');

      try {
        // Promote gallery to primary
        await client.query(`
          UPDATE poi_media
          SET role = 'primary'
          WHERE id = $1
        `, [row.media_id]);

        // Set has_primary_image flag
        await client.query(`
          UPDATE pois
          SET has_primary_image = true
          WHERE id = $1 AND has_primary_image = false
        `, [row.id]);

        await client.query('COMMIT');

        console.log(`[PROMOTE] ${row.name} (POI ${row.id}) - asset ${row.image_server_asset_id} promoted to primary`);
        promoted++;
        flagged++;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[ERROR] Failed to promote ${row.name} (POI ${row.id}):`, error.message);
      }
    }
  } finally {
    client.release();
  }

  console.log('\n=== Summary ===');
  console.log(`Promoted: ${promoted} gallery images to primary`);
  console.log(`Updated: ${flagged} has_primary_image flags`);

  // Verification
  const verification = await pool.query(`
    SELECT COUNT(*) as orphaned_count
    FROM pois p
    JOIN poi_media pm ON p.id = pm.poi_id
    WHERE p.has_primary_image = false
      AND pm.role = 'gallery'
      AND pm.moderation_status IN ('published', 'auto_approved')
      AND NOT EXISTS (
        SELECT 1 FROM poi_media pm2
        WHERE pm2.poi_id = p.id
          AND pm2.role = 'primary'
          AND pm2.moderation_status IN ('published', 'auto_approved')
      )
  `);

  console.log(`\nRemaining orphaned gallery images: ${verification.rows[0].orphaned_count} (should be 0)`);

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  pool.end();
  process.exit(1);
});
