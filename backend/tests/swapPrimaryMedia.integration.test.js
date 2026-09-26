/**
 * swapPrimaryMedia against real PostgreSQL: the delete-then-insert must be
 * atomic, so a failed INSERT leaves the old primary image in place.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { swapPrimaryMedia } from '../routes/admin.js';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD || 'rotv'
});

const POI_ID = 999970;

async function mediaRows() {
  const { rows } = await pool.query(
    `SELECT image_server_asset_id AS asset, role, moderation_status AS status
       FROM poi_media WHERE poi_id = $1 ORDER BY role, image_server_asset_id`,
    [POI_ID]
  );
  return rows;
}

beforeEach(async () => {
  await pool.query('DELETE FROM pois WHERE id = $1', [POI_ID]);
  await pool.query(
    `INSERT INTO pois (id, name, poi_roles, latitude, longitude) VALUES ($1, '_swap_probe', '{point}', 41.2, -81.5)`,
    [POI_ID]
  );
  await pool.query(
    `INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, moderation_status) VALUES
       ($1, 'image', 'old-primary', 'primary', 'auto_approved'),
       ($1, 'image', 'gallery-1', 'gallery', 'published')`,
    [POI_ID]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM pois WHERE id = $1', [POI_ID]);
  await pool.end();
});

describe('swapPrimaryMedia (PostgreSQL)', () => {
  it('replaces the primary image and leaves gallery rows alone', async () => {
    await swapPrimaryMedia(pool, POI_ID, 'new-primary', null);

    expect(await mediaRows()).toEqual([
      { asset: 'gallery-1', role: 'gallery', status: 'published' },
      { asset: 'new-primary', role: 'primary', status: 'auto_approved' }
    ]);
  });

  it('keeps the old primary when the INSERT fails after the DELETE', async () => {
    // A null asset id violates poi_media_asset_or_url, so INSERT fails after DELETE ran.
    await expect(swapPrimaryMedia(pool, POI_ID, null, null)).rejects.toThrow(/poi_media_asset_or_url/);

    expect(await mediaRows()).toEqual([
      { asset: 'gallery-1', role: 'gallery', status: 'published' },
      { asset: 'old-primary', role: 'primary', status: 'auto_approved' }
    ]);
  });
});
