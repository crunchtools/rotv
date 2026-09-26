/**
 * geoService against the real PostGIS test database. The unit tests mock the
 * pool; these run the actual containment SQL, ordering and empty-result paths.
 * Fixtures sit in the open Pacific so no seeded boundary can contain them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { getContainingBoundaries, getReassignmentCandidates, getRollupPoiIds } from '../services/geoService.js';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD || 'rotv'
});

const ORG = 999980;
const BIG = 999981;
const SMALL = 999982;
const INSIDE = 999983;
const OUTSIDE = 999984;
const FIXTURE_IDS = [ORG, BIG, SMALL, INSIDE, OUTSIDE];

async function removeFixtures() {
  await pool.query('DELETE FROM pois WHERE id = ANY($1)', [FIXTURE_IDS]);
}

beforeAll(async () => {
  await removeFixtures();
  await pool.query(`
    INSERT INTO pois (id, name, poi_roles, latitude, longitude, owner_id, boundary_geom, geom) VALUES
      ($1, '_geo_org',     '{organization}', 10.0, -150.0, NULL, NULL, NULL),
      ($2, '_geo_big',     '{boundary}',     10.0, -150.0, $1,
        ST_Multi(ST_MakeEnvelope(-151.0, 9.0, -149.0, 11.0, 4326)), NULL),
      ($3, '_geo_small',   '{boundary}',     10.0, -150.0, $1,
        ST_Multi(ST_MakeEnvelope(-150.2, 9.8, -149.8, 10.2, 4326)), NULL),
      ($4, '_geo_inside',  '{point}',        10.0, -150.0, NULL, NULL,
        ST_SetSRID(ST_MakePoint(-150.0, 10.0), 4326)),
      ($5, '_geo_outside', '{point}',        30.0, -170.0, NULL, NULL,
        ST_SetSRID(ST_MakePoint(-170.0, 30.0), 4326))
  `, FIXTURE_IDS);
});

afterAll(async () => {
  await removeFixtures();
  await pool.end();
});

describe('getContainingBoundaries (PostGIS)', () => {
  it('returns every containing boundary, smallest area first', async () => {
    expect(await getContainingBoundaries(pool, INSIDE)).toEqual(['_geo_small', '_geo_big']);
  });

  it('returns [] for a point no boundary contains', async () => {
    expect(await getContainingBoundaries(pool, OUTSIDE)).toEqual([]);
  });
});

describe('getReassignmentCandidates (PostGIS)', () => {
  it('picks the smallest containing boundary and no owner for an unowned point', async () => {
    expect(await getReassignmentCandidates(pool, INSIDE)).toEqual({
      owner: null,
      boundary: { id: SMALL, name: '_geo_small' }
    });
  });

  it('returns the owning organization for an owned POI', async () => {
    const candidates = await getReassignmentCandidates(pool, SMALL);
    expect(candidates.owner).toEqual({ id: ORG, name: '_geo_org' });
  });
});

describe('getRollupPoiIds (PostGIS)', () => {
  it('rolls a boundary up to the points inside its polygon, not those outside', async () => {
    const ids = await getRollupPoiIds(pool, SMALL);
    expect(ids).toEqual(expect.arrayContaining([SMALL, INSIDE]));
    expect(ids).not.toContain(OUTSIDE);
  });

  it('rolls an organization up to its owned boundaries and the points inside them', async () => {
    const ids = await getRollupPoiIds(pool, ORG);
    expect(ids).toEqual(expect.arrayContaining([ORG, BIG, SMALL, INSIDE]));
    expect(ids).not.toContain(OUTSIDE);
  });

  it('returns only the id for a plain point and [] for a missing POI', async () => {
    expect(await getRollupPoiIds(pool, OUTSIDE)).toEqual([OUTSIDE]);
    expect(await getRollupPoiIds(pool, 999989)).toEqual([]);
  });
});
