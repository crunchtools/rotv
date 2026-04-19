/**
 * Clean up duplicate gallery images that are copies of the primary image.
 *
 * Background: Multiple migrations created poi_media records for the same images.
 * The first migration created records with role='gallery', and a later migration
 * (migrate-primary-images.js) created records with role='primary' for the same POIs.
 * This leaves POIs with both a primary and a gallery record pointing to the same
 * (or equivalent) photo, causing double images in the mosaic display.
 *
 * This script:
 * 1. Finds POIs that have exactly one primary AND one gallery image
 * 2. Deletes the redundant gallery record from poi_media
 * 3. Deletes the orphaned asset from the image server (if configured)
 *
 * Usage:
 *   DRY_RUN=1 node backend/migrations/cleanup-duplicate-gallery-images.js   # Preview
 *   node backend/migrations/cleanup-duplicate-gallery-images.js              # Execute
 *
 * Requires: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (or defaults)
 *           IMAGE_SERVER_URL (optional, for asset cleanup)
 */

import pkg from 'pg';
const { Pool } = pkg;

const DRY_RUN = process.env.DRY_RUN === '1';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'rotv',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD
});

// Optional: image server client for asset cleanup
let imageServerUrl = process.env.IMAGE_SERVER_URL;

async function deleteAssetFromServer(assetId) {
  if (!imageServerUrl) return false;
  try {
    const response = await fetch(`${imageServerUrl}/api/assets/${assetId}`, {
      method: 'DELETE'
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Cleanup Duplicate Gallery Images`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`  Image server: ${imageServerUrl || 'not configured (DB only)'}`);
  console.log(`${'='.repeat(60)}\n`);

  // Find POIs with exactly one primary image AND one or more gallery images
  // where the gallery image is likely a duplicate (same media_type, both approved)
  const duplicates = await pool.query(`
    SELECT
      g.id as gallery_media_id,
      g.poi_id,
      p.name as poi_name,
      g.image_server_asset_id as gallery_asset_id,
      g.created_at as gallery_created,
      pr.id as primary_media_id,
      pr.image_server_asset_id as primary_asset_id,
      pr.created_at as primary_created
    FROM poi_media g
    JOIN poi_media pr ON g.poi_id = pr.poi_id
      AND pr.role = 'primary'
      AND pr.media_type = 'image'
      AND pr.moderation_status IN ('published', 'auto_approved')
    JOIN pois p ON p.id = g.poi_id
    WHERE g.role = 'gallery'
      AND g.media_type = 'image'
      AND g.moderation_status IN ('published', 'auto_approved')
      -- Only target POIs where the gallery is the ONLY gallery image
      -- (if there are multiple gallery images, they might be intentionally different)
      AND (
        SELECT COUNT(*) FROM poi_media g2
        WHERE g2.poi_id = g.poi_id
          AND g2.role = 'gallery'
          AND g2.media_type = 'image'
          AND g2.moderation_status IN ('published', 'auto_approved')
      ) = 1
    ORDER BY p.name
  `);

  if (duplicates.rows.length === 0) {
    console.log('No duplicate gallery images found. Nothing to clean up.\n');
    await pool.end();
    return;
  }

  console.log(`Found ${duplicates.rows.length} POIs with duplicate gallery images:\n`);

  let deleted = 0;
  let assetsCleaned = 0;
  let errors = 0;

  for (const row of duplicates.rows) {
    console.log(`  ${row.poi_name} (POI ${row.poi_id})`);
    console.log(`    Primary: media_id=${row.primary_media_id}, asset=${row.primary_asset_id}, created=${row.primary_created}`);
    console.log(`    Gallery: media_id=${row.gallery_media_id}, asset=${row.gallery_asset_id}, created=${row.gallery_created}`);

    if (DRY_RUN) {
      console.log(`    → [DRY RUN] Would delete gallery record ${row.gallery_media_id} and asset ${row.gallery_asset_id}\n`);
      deleted++;
      continue;
    }

    try {
      // Delete the gallery record from poi_media
      await pool.query('DELETE FROM poi_media WHERE id = $1', [row.gallery_media_id]);
      deleted++;
      console.log(`    → Deleted poi_media record ${row.gallery_media_id}`);

      // Try to delete the orphaned asset from image server
      if (row.gallery_asset_id) {
        const assetDeleted = await deleteAssetFromServer(row.gallery_asset_id);
        if (assetDeleted) {
          assetsCleaned++;
          console.log(`    → Deleted asset ${row.gallery_asset_id} from image server`);
        } else {
          console.log(`    → Could not delete asset ${row.gallery_asset_id} (manual cleanup may be needed)`);
        }
      }
      console.log('');
    } catch (err) {
      errors++;
      console.error(`    → ERROR: ${err.message}\n`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Summary:`);
  console.log(`    Records ${DRY_RUN ? 'would be ' : ''}deleted: ${deleted}`);
  if (!DRY_RUN) {
    console.log(`    Assets cleaned from server: ${assetsCleaned}`);
  }
  if (errors > 0) {
    console.log(`    Errors: ${errors}`);
  }
  console.log(`${'='.repeat(60)}\n`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
