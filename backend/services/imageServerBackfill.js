import { createLogger } from '../utils/logger.js';

const logger = createLogger('ImageServerBackfill');

/**
 * Files image-server primaries that have no poi_media row (#770).
 *
 * The thumbnail route falls back to the image server when poi_media has nothing,
 * so these photos display today. They have to be in poi_media before
 * has_primary_image can be derived from it, or deriving would hide them.
 *
 * Skips a place that already has a published primary, and any asset poi_media
 * already knows under any status, so a rejected photo is never brought back.
 * Safe to re-run: a second pass inserts nothing.
 *
 * @param {import('pg').Pool} pool
 * @param {{initialized: boolean, listAllAssets: () => Promise<object[]>}} client
 * @returns {Promise<{assets: number, inserted: number, staleFlags: number} | null>}
 *   null when the image server isn't configured.
 */
export async function backfillImageServerPrimaries(pool, client) {
  if (!client.initialized) return null;

  const primaries = (await client.listAllAssets()).filter(asset =>
    asset.role === 'primary' && asset.poi_id && ['image', 'video'].includes(asset.asset_type));

  const { rowCount: inserted } = await pool.query(`
    INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, moderation_status, moderated_at)
    SELECT DISTINCT ON (a.poi_id) a.poi_id, a.media_type, a.asset_id, 'primary', 'auto_approved', CURRENT_TIMESTAMP
      FROM unnest($1::int[], $2::text[], $3::text[]) AS a(poi_id, asset_id, media_type)
      JOIN pois p ON p.id = a.poi_id
     WHERE NOT EXISTS (SELECT 1 FROM poi_media m WHERE m.image_server_asset_id = a.asset_id)
       AND NOT EXISTS (
             SELECT 1 FROM poi_media m
              WHERE m.poi_id = a.poi_id
                AND m.role = 'primary'
                AND m.moderation_status IN ('published', 'auto_approved'))
     ORDER BY a.poi_id, a.asset_id
  `, [
    primaries.map(asset => asset.poi_id),
    primaries.map(asset => String(asset.id)),
    primaries.map(asset => asset.asset_type)
  ]);

  // Places whose flag the derived value will turn off: nothing poi_media can serve.
  const { rows: [{ count }] } = await pool.query(`
    SELECT COUNT(*)::int AS count FROM pois p
     WHERE p.has_primary_image
       AND NOT EXISTS (
             SELECT 1 FROM poi_media m
              WHERE m.poi_id = p.id
                AND m.role IN ('primary', 'gallery')
                AND m.media_type IN ('image', 'video')
                AND m.moderation_status IN ('published', 'auto_approved'))
  `);

  const result = { assets: primaries.length, inserted, staleFlags: count };
  logger.info(`Image-server primaries: ${result.assets} seen, ${result.inserted} filed in poi_media, ` +
    `${result.staleFlags} places flagged with no photo`);
  return result;
}
