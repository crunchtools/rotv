/**
 * poiMergeService against the real PostGIS test database (spec 048): folding a
 * duplicate point POI into its park boundary, the candidate finder, the name
 * guard, and the routes that follow a merge. Fixtures sit in the open Pacific
 * so no seeded boundary can contain them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import {
  mergePois,
  findParkMergeCandidates,
  assertPoiNameAvailable,
  PoiNameConflictError,
  normalizePoiName,
  originalMergedName,
  resolveMergedIds
} from '../services/poiMergeService.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD
});

const PARK = 999960;
const POINT = 999961;
const SUB_AREA = 999962;
const ORG = 999963;
const TOWN = 999964;
const CHILD = 999965;
const FIXTURE_IDS = [PARK, POINT, SUB_AREA, ORG, TOWN, CHILD];
const USER_EMAIL = '_merge_hiker@example.com';
let userId;

async function removeFixtures() {
  await pool.query('UPDATE pois SET owner_id = NULL, merged_into_id = NULL WHERE id = ANY($1)', [FIXTURE_IDS]);
  await pool.query('DELETE FROM pois WHERE id = ANY($1)', [FIXTURE_IDS]);
}

async function insertFixtures() {
  await removeFixtures();
  await pool.query(`
    INSERT INTO pois (id, name, poi_roles, boundary_type, latitude, longitude, boundary_geom,
                      brief_description, news_url, collection_tier) VALUES
      ($1, '_Merge Run Metro Park', '{boundary}', 'park', NULL, NULL,
        ST_Multi(ST_MakeEnvelope(-150.2, 9.8, -149.8, 10.2, 4326)), NULL, NULL, 'weekly'),
      ($2, '_Merge Run Metro Park Summit County', '{point}', NULL, 10.01, -150.02, NULL,
        'An 890-acre park.', 'https://example.org/news', 'daily'),
      ($3, '_Merge Run Metro Park - Big Bend Area', '{point}', NULL, 10.05, -150.05, NULL,
        'A corner of the park.', NULL, 'weekly'),
      ($4, '_Merge Parks Org', '{organization}', NULL, NULL, NULL, NULL, NULL, NULL, 'weekly'),
      ($5, '_Merge Township', '{boundary}', 'municipal', NULL, NULL,
        ST_Multi(ST_MakeEnvelope(-151.0, 9.0, -149.0, 11.0, 4326)), NULL, NULL, 'weekly'),
      ($6, '_Merge Run Restroom', '{point}', NULL, 10.02, -150.01, NULL, NULL, NULL, 'weekly')
  `, FIXTURE_IDS);
  await pool.query('UPDATE pois SET owner_id = $1 WHERE id = $2', [POINT, CHILD]);
}

async function row(id) {
  return (await pool.query('SELECT * FROM pois WHERE id = $1', [id])).rows[0];
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = $1', [USER_EMAIL]);
  const created = await pool.query(
    `INSERT INTO users (email, oauth_provider, oauth_provider_id) VALUES ($1, 'password', $1) RETURNING id`,
    [USER_EMAIL]
  );
  userId = created.rows[0].id;
});

beforeEach(insertFixtures);

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await removeFixtures();
  await pool.end();
});

describe('normalizePoiName', () => {
  it('ignores case, apostrophe style and a trailing county', () => {
    expect(normalizePoiName('Furnace Run Metro Park Summit County')).toBe('furnace run metro park');
    expect(normalizePoiName('O’Neil Woods Metro Park')).toBe(normalizePoiName("O'Neil Woods Metro Park"));
    expect(normalizePoiName('  Gorge   Metro Park ')).toBe('gorge metro park');
  });

  it('keeps a sub-area distinct from its park', () => {
    expect(normalizePoiName('Sand Run Metro Park - Big Bend Area')).not.toBe(normalizePoiName('Sand Run Metro Park'));
  });

  it('agrees with its SQL twin', async () => {
    const names = [
      'Furnace Run Metro Park Summit County', 'O’Neil Woods Metro Park',
      '  Gorge   Metro Park ', 'Summit County', 'Brecksville Reservation Cuyahoga County'
    ];
    const sql = await pool.query(
      'SELECT poi_name_key(n) AS normalized FROM unnest($1::text[]) WITH ORDINALITY AS t(n, ord) ORDER BY ord',
      [names]
    );
    expect(sql.rows.map(r => r.normalized)).toEqual(names.map(normalizePoiName));
  });
});

describe('findParkMergeCandidates', () => {
  it('pairs a park with its same-named point and skips the sub-area', async () => {
    const mine = (await findParkMergeCandidates(pool)).filter(c => c.park_id === PARK);
    expect(mine).toEqual([{
      park_id: PARK,
      park_name: '_Merge Run Metro Park',
      point_id: POINT,
      point_name: '_Merge Run Metro Park Summit County'
    }]);
  });

  it('offers nothing once the pair is merged', async () => {
    await mergePois(pool, POINT, PARK);
    expect((await findParkMergeCandidates(pool)).filter(c => c.park_id === PARK)).toEqual([]);
  });
});

describe('mergePois', () => {
  it('moves content and coordinates onto the park and retires the point', async () => {
    await mergePois(pool, POINT, PARK);
    const park = await row(PARK);
    const point = await row(POINT);

    expect(park.poi_roles).toEqual(['boundary']);
    expect(park.name).toBe('_Merge Run Metro Park');
    expect(park.brief_description).toBe('An 890-acre park.');
    expect(park.news_url).toBe('https://example.org/news');
    // A defaulted column takes the point's real value, not the boundary's default.
    expect(park.collection_tier).toBe('daily');
    expect(Number(park.latitude)).toBeCloseTo(10.01);
    // The Directions button on a boundary needs the navigation pair.
    expect(Number(park.navigation_latitude)).toBeCloseTo(10.01);
    expect(Number(park.navigation_longitude)).toBeCloseTo(-150.02);

    expect(point.deleted).toBe(true);
    expect(point.merged_into_id).toBe(PARK);
    expect(point.name).toBe(`_Merge Run Metro Park Summit County [merged into #${PARK}]`);
    expect(originalMergedName(point.name)).toBe('_Merge Run Metro Park Summit County');
  });

  it('keeps what the park already had, settings included', async () => {
    await pool.query(`UPDATE pois SET brief_description = 'Park copy.', collection_tier = 'monthly' WHERE id = $1`, [PARK]);
    await mergePois(pool, POINT, PARK);
    const park = await row(PARK);
    expect(park.brief_description).toBe('Park copy.');
    // A park someone has already filled in keeps its own collection settings.
    expect(park.collection_tier).toBe('monthly');
    // Gaps are still filled from the point.
    expect(park.news_url).toBe('https://example.org/news');
  });

  it('repoints news, favorites, visits, media and owned POIs', async () => {
    await pool.query(`INSERT INTO poi_news (poi_id, title, source_url) VALUES ($1, '_merge news', 'https://example.org/_merge-news')`, [POINT]);
    await pool.query('INSERT INTO user_poi_favorites (user_id, poi_id) VALUES ($1, $2), ($1, $3)', [userId, POINT, PARK]);
    await pool.query('INSERT INTO user_visits (user_id, poi_id) VALUES ($1, $2)', [userId, POINT]);
    await pool.query(
      `INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, moderation_status) VALUES
         ($1, 'image', '_merge-park-primary', 'primary', 'published'),
         ($2, 'image', '_merge-point-primary', 'primary', 'published')`,
      [PARK, POINT]
    );

    const outcome = await mergePois(pool, POINT, PARK);
    expect(outcome.moved['poi_news.poi_id']).toBe(1);

    const news = await pool.query(`SELECT poi_id FROM poi_news WHERE title = '_merge news'`);
    expect(news.rows[0].poi_id).toBe(PARK);
    // The user had favorited both: one row survives, on the park.
    const favorites = await pool.query('SELECT poi_id FROM user_poi_favorites WHERE user_id = $1', [userId]);
    expect(favorites.rows.map(r => r.poi_id)).toEqual([PARK]);
    const visits = await pool.query('SELECT poi_id FROM user_visits WHERE user_id = $1', [userId]);
    expect(visits.rows.map(r => r.poi_id)).toEqual([PARK]);
    // One primary image per POI: the point's is demoted, not lost.
    const media = await pool.query(
      `SELECT image_server_asset_id AS asset, role FROM poi_media WHERE poi_id = $1 ORDER BY asset`, [PARK]
    );
    expect(media.rows).toEqual([
      { asset: '_merge-park-primary', role: 'primary' },
      { asset: '_merge-point-primary', role: 'gallery' }
    ]);
    expect((await row(CHILD)).owner_id).toBe(PARK);
  });

  it('keeps photos that exist only in the image server', async () => {
    const imageServer = {
      getPoiAssets: async (poiId) => (poiId === POINT ? [
        { id: 990001, role: 'primary', asset_type: 'image' },
        { id: 990002, role: 'gallery', asset_type: 'video' },
        { id: 990003, role: 'theme', asset_type: 'image' }
      ] : [])
    };
    const outcome = await mergePois(pool, POINT, PARK, { imageServer });
    expect(outcome.moved.image_server_assets).toBe(2);
    const media = await pool.query(
      `SELECT image_server_asset_id AS asset, role, media_type FROM poi_media WHERE poi_id = $1 ORDER BY asset`, [PARK]
    );
    expect(media.rows).toEqual([
      { asset: '990001', role: 'primary', media_type: 'image' },
      { asset: '990002', role: 'gallery', media_type: 'video' }
    ]);
  });

  it('changes nothing on a dry run but reports what would move', async () => {
    await pool.query('INSERT INTO user_visits (user_id, poi_id) VALUES ($1, $2)', [userId, POINT]);
    const outcome = await mergePois(pool, POINT, PARK, { dryRun: true });
    expect(outcome.dryRun).toBe(true);
    expect(outcome.moved['user_visits.poi_id']).toBe(1);
    expect((await row(POINT)).deleted).not.toBe(true);
    expect((await row(PARK)).brief_description).toBeNull();
  });

  it('refuses a pair that is not a point into a park boundary', async () => {
    await expect(mergePois(pool, PARK, POINT)).rejects.toThrow(/must be a park boundary/);
    await expect(mergePois(pool, POINT, TOWN)).rejects.toThrow(/must be a park boundary/);
    await expect(mergePois(pool, ORG, PARK)).rejects.toThrow(/plain point/);
    await expect(mergePois(pool, POINT, POINT)).rejects.toThrow(/into itself/);
  });

  it('refuses a point that was already merged', async () => {
    await mergePois(pool, POINT, PARK);
    await expect(mergePois(pool, POINT, PARK)).rejects.toThrow(/already merged/);
  });
});

describe('assertPoiNameAvailable', () => {
  it('rejects a name another live POI answers to', async () => {
    await expect(assertPoiNameAvailable(pool, { name: '_merge run metro park' }))
      .rejects.toBeInstanceOf(PoiNameConflictError);
    await expect(assertPoiNameAvailable(pool, { name: '_Merge Run Metro Park Cuyahoga County' }))
      .rejects.toBeInstanceOf(PoiNameConflictError);
  });

  it('accepts a new name and a sub-area of an existing park', async () => {
    await expect(assertPoiNameAvailable(pool, { name: '_Merge Brand New Place' })).resolves.toBeUndefined();
    await expect(assertPoiNameAvailable(pool, { name: '_Merge Run Metro Park - Lone Spruce Area' })).resolves.toBeUndefined();
  });

  it('never blocks an edit that leaves the name alone', async () => {
    // The point duplicates the park's name, yet saving it unchanged must work.
    await expect(assertPoiNameAvailable(pool, {
      name: '_Merge Run Metro Park Summit County', id: POINT, currentName: '_Merge Run Metro Park Summit County'
    })).resolves.toBeUndefined();
  });

  it('rejects renaming a POI onto another POI', async () => {
    await expect(assertPoiNameAvailable(pool, {
      name: '_Merge Run Metro Park', id: SUB_AREA, currentName: '_Merge Run Metro Park - Big Bend Area'
    })).rejects.toBeInstanceOf(PoiNameConflictError);
  });

  it('frees the name once the duplicate is merged away', async () => {
    await mergePois(pool, POINT, PARK);
    await expect(assertPoiNameAvailable(pool, { name: '_Merge Run Metro Park Summit County' }))
      .rejects.toBeInstanceOf(PoiNameConflictError); // still the park's name, normalized
    await expect(assertPoiNameAvailable(pool, {
      name: '_Merge Run Metro Park', id: PARK, currentName: '_Merge Run Metro Park'
    })).resolves.toBeUndefined();
  });
});

describe('following a merge', () => {
  beforeEach(async () => { await mergePois(pool, POINT, PARK); });

  it('resolveMergedIds maps a retired id to the survivor', async () => {
    const resolved = await resolveMergedIds(pool, [POINT, PARK, SUB_AREA]);
    expect([...resolved]).toEqual([[POINT, PARK]]);
  });

  it('GET /api/pois/merged tells a device which saved ids moved', async () => {
    const res = await request(BASE_URL).get(`/api/pois/merged?ids=${POINT},${SUB_AREA}`).expect(200);
    expect(res.body).toEqual({ [POINT]: PARK });
  });

  it('redirects the retired permalink to the park', async () => {
    const res = await request(BASE_URL).get('/merge-run-metro-park-summit-county').redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/merge-run-metro-park');
  });

  it('lists the park, not the retired point', async () => {
    const res = await request(BASE_URL).get('/api/pois?role=boundary').expect(200);
    const park = res.body.find(p => p.id === PARK);
    expect(park.brief_description).toBe('An 890-acre park.');
    const points = await request(BASE_URL).get('/api/pois?role=point').expect(200);
    expect(points.body.find(p => p.id === POINT)).toBeUndefined();
  });
});
