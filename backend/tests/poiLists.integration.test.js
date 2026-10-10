/**
 * Migration 101 and poiListService against a real database (spec 050): the
 * migration seeds the 2026 Fall Hiking Spree once, a re-run (every boot) leaves
 * an admin's edits alone, and a list is served only while it is published and
 * in season.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import pg from 'pg';
import { getActiveLists } from '../services/poiListService.js';

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
