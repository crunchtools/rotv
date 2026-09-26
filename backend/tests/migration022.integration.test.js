/**
 * Migration 022 runs on every boot, so it must convert boundary_geom to
 * MultiPolygon in place, backfill from GeoJSON, and be a no-op on rerun.
 * Each case builds its own pois table in a scratch schema of the test database
 * and runs the real migration file against it.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD || 'rotv'
});

const migrationSql = await readFile(new URL('../migrations/022_migrate_boundary_geometry.sql', import.meta.url), 'utf8');

// All statements for one case run on one client with the scratch schema first on
// the search path, so the migration's 'pois'::regclass resolves to the probe table.
async function inProbeSchema(statements) {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO migration022_probe, public');
    const results = [];
    for (const sql of statements) results.push(await client.query(sql));
    return results;
  } finally {
    await client.query('RESET search_path');
    client.release();
  }
}

const COLUMN_TYPE = `SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
  WHERE attrelid = 'pois'::regclass AND attname = 'boundary_geom' AND NOT attisdropped`;
const SHAPES = `SELECT id, GeometryType(boundary_geom) AS kind, ST_NumGeometries(boundary_geom) AS parts
  FROM pois ORDER BY id`;
const MULTI_GEOJSON = '{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,0]]],[[[5,5],[6,5],[6,6],[5,5]]]]}';

beforeEach(async () => {
  await pool.query('DROP SCHEMA IF EXISTS migration022_probe CASCADE');
  await pool.query('CREATE SCHEMA migration022_probe');
});

afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS migration022_probe CASCADE');
  await pool.end();
});

describe('migration 022 (boundary_geom → MultiPolygon)', () => {
  it('converts a Polygon column in place, keeps its data, and backfills from GeoJSON', async () => {
    const [, , , typeRow, shapes] = await inProbeSchema([
      `CREATE TABLE pois (id int, poi_roles text[], geometry jsonb, boundary_geom geometry(Polygon, 4326))`,
      `INSERT INTO pois VALUES
         (1, '{boundary}', NULL, ST_MakeEnvelope(-82, 41, -81, 41.6, 4326)),
         (2, '{boundary}', '${MULTI_GEOJSON}', NULL),
         (3, '{trail}', '{"type":"LineString","coordinates":[[0,0],[1,1]]}', NULL)`,
      migrationSql,
      COLUMN_TYPE,
      SHAPES
    ]);

    expect(typeRow.rows[0].type).toBe('geometry(MultiPolygon,4326)');
    expect(shapes.rows).toEqual([
      { id: 1, kind: 'MULTIPOLYGON', parts: 1 },
      { id: 2, kind: 'MULTIPOLYGON', parts: 2 },
      { id: 3, kind: null, parts: null }
    ]);
  });

  it('adds the column when it is missing', async () => {
    const [, , , typeRow, shapes] = await inProbeSchema([
      `CREATE TABLE pois (id int, poi_roles text[], geometry jsonb)`,
      `INSERT INTO pois VALUES (1, '{boundary}', '${MULTI_GEOJSON}')`,
      migrationSql,
      COLUMN_TYPE,
      SHAPES
    ]);

    expect(typeRow.rows[0].type).toBe('geometry(MultiPolygon,4326)');
    expect(shapes.rows).toEqual([{ id: 1, kind: 'MULTIPOLYGON', parts: 2 }]);
  });

  it('is a no-op on rerun and never overwrites an existing boundary', async () => {
    const [, , , before, , after] = await inProbeSchema([
      `CREATE TABLE pois (id int, poi_roles text[], geometry jsonb, boundary_geom geometry(MultiPolygon, 4326))`,
      `INSERT INTO pois VALUES
         (1, '{boundary}', '${MULTI_GEOJSON}', ST_Multi(ST_MakeEnvelope(-82, 41, -81, 41.6, 4326)))`,
      migrationSql,
      `SELECT ST_AsText(boundary_geom) AS wkt FROM pois`,
      migrationSql,
      `SELECT ST_AsText(boundary_geom) AS wkt FROM pois`
    ]);

    expect(after.rows).toEqual(before.rows);
    expect(after.rows[0].wkt).toMatch(/^MULTIPOLYGON\(\(\(-82 41/);
  });
});
