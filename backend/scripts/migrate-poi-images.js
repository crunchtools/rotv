#!/usr/bin/env node
/**
 * POI Image Migration Script
 *
 * Migrates existing POI images from PostgreSQL to Immich.
 * This is a one-time migration script for Issue #1 Part 3.
 *
 * Usage:
 *   cd backend
 *   node scripts/migrate-poi-images.js
 *
 * Prerequisites:
 *   - Immich server must be running and configured
 *   - Environment variables or admin_settings must have Immich credentials
 *   - The POI Images album should be created in Immich first
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/rotv'
});

const immichServerUrl = process.env.IMMICH_SERVER_URL;
const immichApiKey = process.env.IMMICH_API_KEY;
const immichAlbumId = process.env.IMMICH_ALBUM_ID;

function loadImmichSettings() {
  if (!immichServerUrl || !immichApiKey || !immichAlbumId) {
    console.error('[Config] Immich not configured. Set IMMICH_SERVER_URL, IMMICH_API_KEY, and IMMICH_ALBUM_ID.');
    process.exit(1);
  }

  console.log(`[Config] Immich server: ${immichServerUrl}`);
  console.log(`[Config] Album: ${immichAlbumId}`);
}

async function uploadToImmich(imageBuffer, poiId, poiName, mimeType) {
  try {
    const ext = mimeType.split('/')[1] || 'jpg';
    const sanitizedName = poiName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `poi-${poiId}-${sanitizedName}.${ext}`;

    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: mimeType });
    formData.append('assetData', blob, filename);
    formData.append('deviceAssetId', `poi-migration-${poiId}-${Date.now()}`);
    formData.append('deviceId', 'rotv-migration');
    formData.append('fileCreatedAt', new Date().toISOString());
    formData.append('fileModifiedAt', new Date().toISOString());

    const response = await fetch(`${immichServerUrl}/api/assets`, {
      method: 'POST',
      headers: {
        'x-api-key': immichApiKey
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    const asset = await response.json();

    if (immichAlbumId) {
      await addToAlbum(asset.id);
    }

    await tagAsset(asset.id, poiId);

    return { success: true, assetId: asset.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function addToAlbum(assetId) {
  try {
    await fetch(`${immichServerUrl}/api/albums/${immichAlbumId}/assets`, {
      method: 'PUT',
      headers: {
        'x-api-key': immichApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ids: [assetId] })
    });
  } catch (error) {
    console.warn(`  Warning: Failed to add to album: ${error.message}`);
  }
}

async function tagAsset(assetId, poiId) {
  try {
    await fetch(`${immichServerUrl}/api/assets/${assetId}`, {
      method: 'PUT',
      headers: {
        'x-api-key': immichApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: `poi_${poiId}, type_primary`
      })
    });
  } catch (error) {
    console.warn(`  Warning: Failed to tag asset: ${error.message}`);
  }
}

async function migrate() {
  console.log('='.repeat(60));
  console.log('POI Image Migration to Immich');
  console.log('='.repeat(60));
  console.log();

  loadImmichSettings();
  console.log();

  const poisQuery = await pool.query(`
    SELECT id, name, image_data, image_mime_type
    FROM pois
    WHERE image_data IS NOT NULL
      AND (immich_primary_asset_id IS NULL OR immich_primary_asset_id = '')
    ORDER BY id
  `);

  const pois = poisQuery.rows;
  console.log(`[Migration] Found ${pois.length} POIs with images to migrate`);
  console.log();

  if (pois.length === 0) {
    console.log('No images to migrate. All POIs already have Immich assets or no images.');
    await pool.end();
    return;
  }

  let migrated = 0;
  let failed = 0;
  const failures = [];

  for (const poi of pois) {
    process.stdout.write(`[${migrated + failed + 1}/${pois.length}] Migrating POI ${poi.id} (${poi.name})... `);

    const uploadResult = await uploadToImmich(
      poi.image_data,
      poi.id,
      poi.name,
      poi.image_mime_type || 'image/jpeg'
    );

    if (uploadResult.success) {
      await pool.query(
        'UPDATE pois SET immich_primary_asset_id = $1 WHERE id = $2',
        [uploadResult.assetId, poi.id]
      );
      console.log(`OK (${uploadResult.assetId})`);
      migrated++;
    } else {
      console.log(`FAILED - ${uploadResult.error}`);
      failed++;
      failures.push({ id: poi.id, name: poi.name, error: uploadResult.error });
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Migration Complete');
  console.log('='.repeat(60));
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Failed: ${failed}`);

  if (failures.length > 0) {
    console.log();
    console.log('Failed POIs:');
    failures.forEach(f => {
      console.log(`  - POI ${f.id} (${f.name}): ${f.error}`);
    });
  }

  await pool.end();
}

migrate().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
