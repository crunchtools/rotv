/**
 * Restore POI images from Immich backup
 * Runs inside ROTV container
 */

import fs from 'fs';
import { createReadStream } from 'fs';
import pkg from 'pg';
const { Pool } = pkg;
import imageServerClient from '../services/imageServerClient.js';

const CSV_FILE = '/tmp/immich-poi-images.csv';
const BACKUP_BASE = '/mnt/immich-backup';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'rootsofthevalley',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD
});

// Initialize image server client
imageServerClient.initialize();

function extractPoiId(filename) {
  const match = filename.match(/^poi-(\d+)-/);
  return match ? parseInt(match[1]) : null;
}

function convertToBackupPath(immichPath) {
  const relativePath = immichPath.replace('/usr/src/app/', '');
  return `${BACKUP_BASE}/${relativePath}`;
}

async function main() {
  console.log('Starting POI image restoration from Immich backup...\n');

  const csvContent = fs.readFileSync(CSV_FILE, 'utf-8');
  const lines = csvContent.trim().split('\n');

  console.log(`Found ${lines.length} images to restore\n`);

  // Check which POIs already have primary images in the ROTV database
  const existingPrimaries = await pool.query(`
    SELECT DISTINCT poi_id
    FROM poi_media
    WHERE role = 'primary'
      AND moderation_status IN ('published', 'auto_approved')
  `);
  const poisWithPrimary = new Set(existingPrimaries.rows.map(r => r.poi_id));
  console.log(`${poisWithPrimary.size} POIs have primary images in ROTV database`);

  // Also check which POIs have primary images in the image server database
  const imageServerPrimaries = await imageServerClient.listAllAssets();
  for (const asset of imageServerPrimaries) {
    if (asset.role === 'primary' && asset.poi_id) {
      poisWithPrimary.add(asset.poi_id);
    }
  }
  console.log(`${poisWithPrimary.size} POIs have primary images (ROTV + image server combined)\n`);

  const poiFirstImage = new Map();
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const [immichId, filename, immichPath] = lines[i].split(',');
    const poiId = extractPoiId(filename);

    if (!poiId) {
      console.log(`[${i + 1}/${lines.length}] SKIP: Cannot extract POI ID from ${filename}`);
      skipCount++;
      continue;
    }

    const backupPath = convertToBackupPath(immichPath);

    if (!fs.existsSync(backupPath)) {
      console.log(`[${i + 1}/${lines.length}] ERROR: File not found: ${backupPath}`);
      errorCount++;
      continue;
    }

    console.log(`[${i + 1}/${lines.length}] Processing POI ${poiId}: ${filename}`);

    try {
      // Read the image file
      const imageBuffer = fs.readFileSync(backupPath);
      const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

      // Only set as primary if POI doesn't have one AND this is the first from Immich
      const role = (!poisWithPrimary.has(poiId) && !poiFirstImage.has(poiId)) ? 'primary' : 'gallery';

      // Upload to image server
      const result = await imageServerClient.uploadImage(
        imageBuffer,
        poiId,
        role,
        filename,
        mimeType
      );

      if (!result.success) {
        throw new Error(result.error);
      }

      console.log(`  ✓ Uploaded to image server: ${result.assetId} (role: ${role})`);

      // Create poi_media record
      await pool.query(`
        INSERT INTO poi_media (poi_id, image_server_asset_id, media_type, role, moderation_status)
        VALUES ($1, $2, 'image', $3, 'auto_approved')
      `, [poiId, result.assetId, role]);

      console.log(`  ✓ Created poi_media record (role: ${role})`);

      // Update POI has_primary_image flag if this is the first image
      if (role === 'primary') {
        await pool.query(`
          UPDATE pois
          SET has_primary_image = true
          WHERE id = $1
        `, [poiId]);
        console.log(`  ✓ Updated POI ${poiId} has_primary_image=true`);
        poiFirstImage.set(poiId, result.assetId);
        poisWithPrimary.add(poiId);
      }

      successCount++;
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      errorCount++;
    }

    console.log('');
  }

  console.log('\n=== Restoration Summary ===');
  console.log(`Total images: ${lines.length}`);
  console.log(`✓ Success: ${successCount}`);
  console.log(`⊘ Skipped: ${skipCount}`);
  console.log(`✗ Errors: ${errorCount}`);
  console.log(`POIs updated: ${poiFirstImage.size}`);

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  pool.end();
  process.exit(1);
});
