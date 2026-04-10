/**
 * Sync MTB trail images from image server to ROTV database
 *
 * Issue: MTB trail images exist on image server but missing poi_media records in ROTV db
 * This creates the linking records so images can be displayed.
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

// MTB trail POI IDs and their corresponding image server asset IDs
const mtbImages = [
  { poi_id: 5527, asset_id: 21, name: 'East Rim Trailhead' },
  { poi_id: 5544, asset_id: 29, name: 'Hampton Hills Mountain Bike Trailhead' },
  { poi_id: 5591, asset_id: 43, name: 'Ohio & Erie Canal Mountain Bike Trailhead' },
  { poi_id: 5680, asset_id: 68, name: 'Reagan-Huffman Mountain Bike Trailhead' },
  { poi_id: 5681, asset_id: 69, name: 'Bedford Reserve Mountain Bike Trailhead' },
  { poi_id: 5682, asset_id: 70, name: 'Royalview Mountain Bike Trailhead' },
  { poi_id: 5683, asset_id: 71, name: 'West Creek Mountain Bike Trailhead' }
];

async function main() {
  console.log('Syncing MTB trail images from image server...\n');

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const { poi_id, asset_id, name } of mtbImages) {
    // Check if poi_media record already exists
    const existing = await pool.query(
      'SELECT id FROM poi_media WHERE poi_id = $1 AND image_server_asset_id = $2',
      [poi_id, asset_id]
    );

    if (existing.rows.length > 0) {
      console.log(`[SKIP] ${name} - poi_media record already exists`);
      skipped++;
      continue;
    }

    // Create poi_media record
    await pool.query(`
      INSERT INTO poi_media (poi_id, image_server_asset_id, media_type, role, moderation_status)
      VALUES ($1, $2, 'image', 'primary', 'auto_approved')
    `, [poi_id, asset_id]);

    console.log(`[CREATE] ${name} - created poi_media record (asset ${asset_id})`);
    created++;

    // Update has_primary_image flag
    const result = await pool.query(`
      UPDATE pois
      SET has_primary_image = true
      WHERE id = $1 AND has_primary_image = false
      RETURNING id
    `, [poi_id]);

    if (result.rows.length > 0) {
      console.log(`[UPDATE] ${name} - set has_primary_image=true`);
      updated++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Created: ${created} poi_media records`);
  console.log(`Updated: ${updated} has_primary_image flags`);
  console.log(`Skipped: ${skipped} (already synced)`);

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  pool.end();
  process.exit(1);
});
