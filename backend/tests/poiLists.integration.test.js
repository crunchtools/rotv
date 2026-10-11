/**
 * Migration 101 and poiListService against a real database (spec 050): the
 * migration seeds the 2026 Fall Hiking Spree once, a re-run (every boot) leaves
 * an admin's edits alone, a list is served only while it is published and in
 * season, and a check-in is kept only when the spree's rules allow it.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import pg from 'pg';
import {
  getActiveLists, getListsByIds, checkinProblem, saveCheckin, removeCheckin, getUserCheckins,
  syncCheckins, CheckinError
} from '../services/poiListService.js';

const adminPool = new pg.Pool();
// public stays on the path for the PostGIS types and functions the migration uses.
const probe = new pg.Pool({ options: '-c search_path=poi_lists_probe,public' });
const migration = await readFile(new URL('../migrations/101_poi_lists.sql', import.meta.url), 'utf8');

// Spree trails that had a POI before the migration; it adds the other five.
const EXISTING_TRAILS = [
  'Ohio & Erie Canal Towpath Trail', 'Missing Link Trail', 'Quarry Trail', 'Rock Creek Trail',
  'Parcours Trail', 'Adam Run Trail', 'Seneca Trail', 'Nuthatch Trail'
];

beforeEach(async () => {
  await adminPool.query('DROP SCHEMA IF EXISTS poi_lists_probe CASCADE');
  await adminPool.query('CREATE SCHEMA poi_lists_probe');
  await probe.query(`
    CREATE TABLE pois (
      id serial PRIMARY KEY, name text UNIQUE, brief_description text, poi_roles text[],
      boundary_type text, boundary_color text, latitude numeric, longitude numeric,
      navigation_latitude numeric, navigation_longitude numeric, primary_activities text,
      length_miles numeric, difficulty text, property_owner text, owner_id int, geometry jsonb,
      more_info_link text, deleted boolean, geom geometry(Point, 4326),
      boundary_geom geometry(MultiPolygon, 4326)
    )
  `);
  await probe.query('CREATE TABLE users (id serial PRIMARY KEY, email text)');
  await probe.query('INSERT INTO users (email) VALUES ($1), ($2)', ['hiker@example.com', 'other@example.com']);
  await probe.query(
    `INSERT INTO pois (name, poi_roles) VALUES ($1, '{organization}')`,
    ['Summit Metro Parks']
  );
  await probe.query(
    `INSERT INTO pois (name, poi_roles) SELECT unnest($1::text[]), '{trail}'`,
    [EXISTING_TRAILS]
  );
});

afterAll(async () => {
  await probe.end();
  await adminPool.query('DROP SCHEMA IF EXISTS poi_lists_probe CASCADE');
  await adminPool.end();
});

describe('migration 101 (curated lists, 2026 Fall Hiking Spree)', () => {
  it('adds the missing trails and Wood Hollow Metro Park under Summit Metro Parks', async () => {
    await probe.query(migration);

    const added = await probe.query(
      `SELECT p.name, p.poi_roles, p.boundary_type, o.name AS owner,
              p.geometry->>'type' AS shape, p.boundary_geom IS NOT NULL AS has_outline
         FROM pois p LEFT JOIN pois o ON o.id = p.owner_id
        WHERE p.name <> ALL($1::text[]) AND p.name <> $2
        ORDER BY p.name`,
      [EXISTING_TRAILS, 'Summit Metro Parks']
    );
    expect(added.rows.map(r => r.name)).toEqual([
      'Black Bear Trail', 'Chippewa Trail', 'Downy Loop Trail', 'Firefly Trail', 'Willow Trail',
      'Wood Hollow Metro Park'
    ]);
    expect(added.rows.every(r => r.owner === 'Summit Metro Parks')).toBe(true);
    const park = added.rows.find(r => r.name === 'Wood Hollow Metro Park');
    expect(park).toMatchObject({ poi_roles: ['boundary'], boundary_type: 'park', has_outline: true });
    expect(added.rows.filter(r => r !== park).every(r => r.shape === 'LineString')).toBe(true);
  });

  it('seeds the 2026 spree with a trailhead for all thirteen hikes', async () => {
    await probe.query(migration);

    const [spree] = await getActiveLists(probe, '2026-10-10');
    expect(spree).toMatchObject({
      slug: 'fall-hiking-spree', edition: 2026, name: 'Fall Hiking Spree', goal_count: 8,
      starts_on: '2026-09-01', ends_on: '2026-11-30'
    });
    expect(spree.items.map(i => i.position)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(spree.items.every(i => Number.isFinite(i.nav_latitude) && Number.isFinite(i.nav_longitude))).toBe(true);
    expect(spree.items[0]).toMatchObject({ label: 'Towpath Trail from Wilbeth Road', miles: 2.2, rating: 'Easy' });
  });

  it('leaves an edited list alone when it runs again', async () => {
    await probe.query(migration);
    await probe.query('DELETE FROM poi_list_items WHERE position = $1', [13]);
    await probe.query('UPDATE poi_lists SET name = $1', ['Spree, edited']);

    await probe.query(migration);

    const [spree] = await getActiveLists(probe, '2026-10-10');
    expect(spree.name).toBe('Spree, edited');
    expect(spree.items).toHaveLength(12);
    const pois = await probe.query('SELECT count(*)::int AS n FROM pois');
    expect(pois.rows[0].n).toBe(EXISTING_TRAILS.length + 7);
  });
});

describe('getActiveLists', () => {
  it('serves a list only inside its season', async () => {
    await probe.query(migration);

    expect(await getActiveLists(probe, '2026-08-31')).toEqual([]);
    expect(await getActiveLists(probe, '2026-09-01')).toHaveLength(1);
    expect(await getActiveLists(probe, '2026-11-30')).toHaveLength(1);
    expect(await getActiveLists(probe, '2026-12-01')).toEqual([]);
  });

  it('hides a draft and drops an item whose place was deleted', async () => {
    await probe.query(migration);
    await probe.query('UPDATE pois SET deleted = TRUE WHERE name = $1', ['Willow Trail']);

    const [spree] = await getActiveLists(probe, '2026-10-10');
    expect(spree.items.map(i => i.label)).not.toContain('Willow Trail');
    expect(spree.items).toHaveLength(12);

    await probe.query('UPDATE poi_lists SET status = $1', ['draft']);
    expect(await getActiveLists(probe, '2026-10-10')).toEqual([]);
  });
});

describe('check-ins', () => {
  const HIKER = 1;
  const OTHER = 2;
  const TODAY = '2026-10-11';
  let spree;
  const item = (label) => spree.items.find(i => i.label === label);

  beforeEach(async () => {
    await probe.query(migration);
    [spree] = await getActiveLists(probe, TODAY);
  });

  it('allows a hike on the list inside the season, up to today', () => {
    const quarry = item('Quarry Trail').id;
    expect(checkinProblem(spree, { item_id: quarry, done_on: '2026-09-01' }, TODAY)).toBeNull();
    expect(checkinProblem(spree, { item_id: quarry, done_on: TODAY }, TODAY)).toBeNull();
    expect(checkinProblem(spree, { item_id: quarry, done_on: '2026-08-31' }, TODAY)).toMatch(/2026-09-01 through 2026-11-30/);
    expect(checkinProblem(spree, { item_id: quarry, done_on: '2026-10-12' }, TODAY)).toMatch(/not happened/);
    expect(checkinProblem(spree, { item_id: quarry, done_on: '2026-12-01' }, '2026-12-15')).toMatch(/through/);
    expect(checkinProblem(spree, { item_id: quarry, done_on: 'last week' }, TODAY)).toMatch(/date/);
    expect(checkinProblem(spree, { item_id: 999999, done_on: TODAY }, TODAY)).toMatch(/not on this list/);
  });

  it('allows the free choice only where the list offers one', () => {
    expect(checkinProblem(spree, { item_id: null, poi_id: 5, done_on: TODAY }, TODAY)).toBeNull();
    expect(checkinProblem(spree, { item_id: null, poi_id: null, done_on: TODAY }, TODAY)).toMatch(/Pick the trail/);
    expect(checkinProblem({ ...spree, choice_label: null }, { item_id: null, poi_id: 5, done_on: TODAY }, TODAY))
      .toMatch(/no free choice/);
  });

  it('logs a hike once per trail and lets the date be corrected', async () => {
    const quarry = item('Quarry Trail');
    await saveCheckin(probe, HIKER, spree.id, { item_id: quarry.id, done_on: '2026-10-03' }, TODAY);
    const saved = await saveCheckin(probe, HIKER, spree.id, { item_id: quarry.id, done_on: '2026-10-04' }, TODAY);

    expect(saved).toEqual({ list_id: spree.id, item_id: quarry.id, poi_id: quarry.poi_id, done_on: '2026-10-04' });
    expect(await getUserCheckins(probe, HIKER)).toEqual([saved]);
    expect(await getUserCheckins(probe, OTHER)).toEqual([]);
  });

  it('takes one free choice, which must be a trail', async () => {
    const pois = await probe.query('SELECT id, name FROM pois WHERE name = ANY($1::text[])', [['Seneca Trail', 'Summit Metro Parks', 'Willow Trail']]);
    const idOf = (name) => pois.rows.find(p => p.name === name).id;

    await expect(saveCheckin(probe, HIKER, spree.id, { item_id: null, poi_id: idOf('Summit Metro Parks'), done_on: TODAY }, TODAY))
      .rejects.toBeInstanceOf(CheckinError);
    await saveCheckin(probe, HIKER, spree.id, { item_id: null, poi_id: idOf('Seneca Trail'), done_on: '2026-10-01' }, TODAY);
    await saveCheckin(probe, HIKER, spree.id, { item_id: null, poi_id: idOf('Willow Trail'), done_on: '2026-10-02' }, TODAY);

    expect(await getUserCheckins(probe, HIKER)).toEqual([
      { list_id: spree.id, item_id: null, poi_id: idOf('Willow Trail'), done_on: '2026-10-02' }
    ]);
  });

  it('refuses a hike the rules do not allow, and an unknown list', async () => {
    const quarry = item('Quarry Trail');
    await expect(saveCheckin(probe, HIKER, spree.id, { item_id: quarry.id, done_on: '2026-08-01' }, TODAY))
      .rejects.toMatchObject({ status: 400 });
    await expect(saveCheckin(probe, HIKER, 424242, { item_id: quarry.id, done_on: TODAY }, TODAY))
      .rejects.toMatchObject({ status: 404 });
    expect(await getUserCheckins(probe, HIKER)).toEqual([]);
  });

  it('removes a hike, and the free choice, separately', async () => {
    const quarry = item('Quarry Trail');
    const seneca = item('Seneca Trail');
    await saveCheckin(probe, HIKER, spree.id, { item_id: quarry.id, done_on: TODAY }, TODAY);
    await saveCheckin(probe, HIKER, spree.id, { item_id: null, poi_id: seneca.poi_id, done_on: TODAY }, TODAY);

    expect(await removeCheckin(probe, HIKER, spree.id, null)).toBe(true);
    expect((await getUserCheckins(probe, HIKER)).map(c => c.item_id)).toEqual([quarry.id]);
    expect(await removeCheckin(probe, HIKER, spree.id, quarry.id)).toBe(true);
    expect(await removeCheckin(probe, HIKER, spree.id, quarry.id)).toBe(false);
  });

  it('folds a device\'s hikes into the account without overwriting what it has', async () => {
    const quarry = item('Quarry Trail');
    const willow = item('Willow Trail');
    await saveCheckin(probe, HIKER, spree.id, { item_id: quarry.id, done_on: '2026-10-05' }, TODAY);

    const added = await syncCheckins(probe, HIKER, [
      { list_id: spree.id, item_id: quarry.id, done_on: '2026-09-20' },
      { list_id: spree.id, item_id: willow.id, done_on: '2026-09-21' },
      { list_id: spree.id, item_id: willow.id, done_on: '2026-07-04' },
      { list_id: 424242, item_id: willow.id, done_on: '2026-09-21' },
      { item_id: willow.id }
    ], TODAY);

    expect(added).toBe(1);
    expect(await getUserCheckins(probe, HIKER)).toEqual([
      { list_id: spree.id, item_id: willow.id, poi_id: willow.poi_id, done_on: '2026-09-21' },
      { list_id: spree.id, item_id: quarry.id, poi_id: quarry.poi_id, done_on: '2026-10-05' }
    ]);
  });

  it('keeps a past season\'s list and hikes readable after it ends', async () => {
    const quarry = item('Quarry Trail');
    await saveCheckin(probe, HIKER, spree.id, { item_id: quarry.id, done_on: '2026-11-30' }, '2026-12-20');

    expect(await getActiveLists(probe, '2027-06-01')).toEqual([]);
    const [past] = await getListsByIds(probe, [spree.id]);
    expect(past).toMatchObject({ slug: 'fall-hiking-spree', edition: 2026, rewards_until: '2027-03-31', featured: true });
    expect(await getUserCheckins(probe, HIKER)).toHaveLength(1);
  });
});
