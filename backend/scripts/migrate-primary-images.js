#!/usr/bin/env node
/**
 * Migration script to populate poi_media from existing primary images
 * Run with: node backend/scripts/migrate-primary-images.js [--dry-run]
 *
 * This script:
 * 1. Queries image server for all POIs with primary images
 * 2. Creates poi_media records with role='primary' and status='published'
 * 3. Skips POIs that already have primary entries in poi_media
 */

import pg from 'pg';
import fetch from 'node-fetch';

const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const IMAGE_SERVER_URL = process.env.IMAGE_SERVER_URL || 'http://10.89.1.100:8000';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'rotv',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres'
});

/**
 * Fetch primary asset for a POI from image server
 */
async function fetchPrimaryAsset(poiId) {
  try {
    const response = await fetch(`${IMAGE_SERVER_URL}/api/assets?poi_id=${poiId}&role=primary`);

    if (!response.ok) {
      return null;
    }

    const assets = await response.json();
    return assets.length > 0 ? assets[0] : null;
  } catch (error) {
    console.error(`Failed to fetch asset for POI ${poiId}:`, error.message);
    return null;
  }
}

/**
 * Check if POI already has a primary entry in poi_media
 */
async function hasPrimaryMedia(poiId) {
  const existingMedia = await pool.query(
    `SELECT id FROM poi_media WHERE poi_id = $1 AND role = 'primary' LIMIT 1`,
    [poiId]
  );
  return existingMedia.rows.length > 0;
}

/**
 * Create poi_media entry for primary image
 */
async function createPrimaryMediaEntry(poiId, assetId) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would create poi_media entry: POI ${poiId} -> asset ${assetId}`);
    return { id: -1 };
  }

  const createdMedia = await pool.query(
    `INSERT INTO poi_media (
      poi_id,
      media_type,
      image_server_asset_id,
      role,
      sort_order,
      moderation_status,
      moderated_at,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING id`,
    [poiId, 'image', assetId, 'primary', 0, 'published']
  );

  return createdMedia.rows[0];
}

/**
 * Main migration logic
 */
async function migrateImages() {
  console.log('='.repeat(60));
  console.log('Primary Image Migration');
  console.log('='.repeat(60));
  console.log(`Image Server: ${IMAGE_SERVER_URL}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log('');

  try {
    const poisWithImages = await pool.query(
      `SELECT id, name FROM pois WHERE has_primary_image = true ORDER BY id`
    );

    const pois = poisWithImages.rows;
    console.log(`Found ${pois.length} POIs with primary images\n`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const poi of pois) {
      const hasEntry = await hasPrimaryMedia(poi.id);
      if (hasEntry) {
        console.log(`✓ POI ${poi.id} (${poi.name}): Already has primary entry, skipping`);
        skipped++;
        continue;
      }

      const asset = await fetchPrimaryAsset(poi.id);

      if (!asset) {
        console.log(`✗ POI ${poi.id} (${poi.name}): No primary asset found on image server`);
        failed++;
        continue;
      }

      await createPrimaryMediaEntry(poi.id, asset.id);
      console.log(`✓ POI ${poi.id} (${poi.name}): Migrated asset ${asset.id}`);
      migrated++;
    }

    console.log('\n' + '='.repeat(60));
    console.log('Migration Summary');
    console.log('='.repeat(60));
    console.log(`Total POIs: ${pois.length}`);
    console.log(`Migrated: ${migrated}`);
    console.log(`Skipped (already exists): ${skipped}`);
    console.log(`Failed (no asset found): ${failed}`);
    console.log('');

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - No changes were made');
      console.log('   Run without --dry-run to apply changes\n');
    } else {
      console.log('✓ Migration complete\n');
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrateImages();
