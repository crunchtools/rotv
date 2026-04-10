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

imageServerClient.initialize();

console.log('Starting POI image restoration from Immich backup...\n');

const csvContent = fs.readFileSync(CSV_FILE, 'utf-8');
const lines = csvContent.trim().split('\n');

console.log(`Found ${lines.length} images to restore\n`);

const existingPrimaries = await pool.query(`
  SELECT DISTINCT poi_id
  FROM poi_media
  WHERE role = 'primary'
    AND moderation_status IN ('published', 'auto_approved')
`);
const poisWithPrimary = new Set(existingPrimaries.rows.map(r => r.poi_id));
console.log(`${poisWithPrimary.size} POIs have primary images in ROTV database`);

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

  const poiIdMatch = filename.match(/^poi-(\d+)-/);
  const poiId = poiIdMatch ? parseInt(poiIdMatch[1]) : null;

  if (!poiId) {
    console.log(`[${i + 1}/${lines.length}] SKIP: Cannot extract POI ID from ${filename}`);
    skipCount++;
    continue;
  }

  const relativePath = immichPath.replace('/usr/src/app/', '');
  const backupPath = `${BACKUP_BASE}/${relativePath}`;

  if (!fs.existsSync(backupPath)) {
    console.log(`[${i + 1}/${lines.length}] ERROR: File not found: ${backupPath}`);
    errorCount++;
    continue;
  }

  console.log(`[${i + 1}/${lines.length}] Processing POI ${poiId}: ${filename}`);

  try {
    const imageBuffer = fs.readFileSync(backupPath);
    const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const role = (!poisWithPrimary.has(poiId) && !poiFirstImage.has(poiId)) ? 'primary' : 'gallery';

    const uploadResult = await imageServerClient.uploadImage(
      imageBuffer,
      poiId,
      role,
      filename,
      mimeType
    );

    if (!uploadResult.success) {
      throw new Error(uploadResult.error);
    }

    console.log(`  ✓ Uploaded to image server: ${uploadResult.assetId} (role: ${role})`);

    await pool.query(`
      INSERT INTO poi_media (poi_id, image_server_asset_id, media_type, role, moderation_status)
      VALUES ($1, $2, 'image', $3, 'auto_approved')
    `, [poiId, uploadResult.assetId, role]);

    console.log(`  ✓ Created poi_media record (role: ${role})`);

    if (role === 'primary') {
      await pool.query(`
        UPDATE pois
        SET has_primary_image = true
        WHERE id = $1
      `, [poiId]);
      console.log(`  ✓ Updated POI ${poiId} has_primary_image=true`);
      poiFirstImage.set(poiId, uploadResult.assetId);
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
