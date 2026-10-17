/**
 * backfillImageServerPrimaries against real PostgreSQL (#770): files photos the
 * image server holds but poi_media doesn't, and never touches what poi_media has.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { backfillImageServerPrimaries } from '../services/imageServerBackfill.js';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD || 'rotv'
});

// Orphaned primary, place with a primary already, place with that asset rejected.
const [ORPHAN, HAS_PRIMARY, REJECTED] = [999960, 999961, 999962];
const IDS = [ORPHAN, HAS_PRIMARY, REJECTED];

const client = {
  initialized: true,
  listAllAssets: async () => [
    { id: 9001, poi_id: ORPHAN, role: 'primary', asset_type: 'image' },
    { id: 9002, poi_id: HAS_PRIMARY, role: 'primary', asset_type: 'image' },
    { id: 9003, poi_id: REJECTED, role: 'primary', asset_type: 'image' },
    { id: 9004, poi_id: 999969, role: 'primary', asset_type: 'image' }
  ]
};

beforeEach(async () => {
  await pool.query('DELETE FROM pois WHERE id = ANY($1)', [IDS]);
  for (const id of IDS) {
    await pool.query(
      `INSERT INTO pois (id, name, poi_roles, latitude, longitude) VALUES ($1, $2, '{point}', 41.2, -81.5)`,
      [id, `_backfill_probe_${id}`]
    );
  }
  await pool.query(
    `INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, moderation_status) VALUES
       ($1, 'image', 'kept-primary', 'primary', 'auto_approved'),
       ($2, 'image', '9003', 'primary', 'rejected')`,
    [HAS_PRIMARY, REJECTED]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM pois WHERE id = ANY($1)', [IDS]);
  await pool.end();
});

describe('backfillImageServerPrimaries (PostgreSQL)', () => {
  it('files only the orphaned primary, and a second run adds nothing', async () => {
    const first = await backfillImageServerPrimaries(pool, client);
    const second = await backfillImageServerPrimaries(pool, client);

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    const { rows } = await pool.query(
      `SELECT poi_id, image_server_asset_id AS asset, role, moderation_status AS status
         FROM poi_media WHERE poi_id = ANY($1) ORDER BY poi_id, image_server_asset_id`,
      [IDS]
    );
    expect(rows).toEqual([
      { poi_id: ORPHAN, asset: '9001', role: 'primary', status: 'auto_approved' },
      { poi_id: HAS_PRIMARY, asset: 'kept-primary', role: 'primary', status: 'auto_approved' },
      { poi_id: REJECTED, asset: '9003', role: 'primary', status: 'rejected' }
    ]);
  });
});
