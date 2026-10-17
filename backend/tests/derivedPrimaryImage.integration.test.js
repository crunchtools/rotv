/**
 * has_primary_image is derived from poi_media by poi_has_primary_image() (#770),
 * with the thumbnail route's predicate, and the stored column is gone.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD || 'rotv'
});

const POI_ID = 999950;

async function addMedia(mediaType, role, status) {
  await pool.query(
    `INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, youtube_url, role, moderation_status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    mediaType === 'youtube'
      ? [POI_ID, mediaType, null, 'https://youtu.be/_derived', role, status]
      : [POI_ID, mediaType, `_derived-${role}-${status}`, null, role, status]
  );
}

async function derived() {
  const { rows } = await pool.query('SELECT poi_has_primary_image($1) AS has', [POI_ID]);
  return rows[0].has;
}

beforeEach(async () => {
  await pool.query('DELETE FROM pois WHERE id = $1', [POI_ID]);
  await pool.query(
    `INSERT INTO pois (id, name, poi_roles, latitude, longitude) VALUES ($1, '_derived_probe', '{point}', 41.2, -81.5)`,
    [POI_ID]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM pois WHERE id = $1', [POI_ID]);
  await pool.end();
});

describe('poi_has_primary_image (#770)', () => {
  it('the stored column is gone', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'pois' AND column_name = 'has_primary_image'`
    );
    expect(rows).toEqual([]);
  });

  it('is false with no media', async () => {
    expect(await derived()).toBe(false);
  });

  it.each([
    ['image', 'primary', 'published'],
    ['image', 'primary', 'auto_approved'],
    ['image', 'gallery', 'published'],
    ['video', 'gallery', 'auto_approved']
  ])('is true for a %s %s that is %s', async (mediaType, role, status) => {
    await addMedia(mediaType, role, status);
    expect(await derived()).toBe(true);
  });

  it.each([
    ['image', 'primary', 'pending'],
    ['image', 'primary', 'rejected'],
    ['youtube', 'gallery', 'published']
  ])('is false for a %s %s that is %s', async (mediaType, role, status) => {
    await addMedia(mediaType, role, status);
    expect(await derived()).toBe(false);
  });

  it('turns false when the last photo is deleted', async () => {
    await addMedia('image', 'primary', 'published');
    await pool.query('DELETE FROM poi_media WHERE poi_id = $1', [POI_ID]);
    expect(await derived()).toBe(false);
  });

  it('rides along on an admin-style RETURNING *', async () => {
    await addMedia('image', 'primary', 'published');
    const { rows } = await pool.query(
      `UPDATE pois SET brief_description = 'x' WHERE id = $1
       RETURNING *, poi_has_primary_image(id) AS has_primary_image`,
      [POI_ID]
    );
    expect(rows[0].has_primary_image).toBe(true);
  });
});
