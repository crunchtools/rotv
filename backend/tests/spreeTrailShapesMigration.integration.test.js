/**
 * Migration 103 against a real database: it replaces a spree trail's
 * incomplete shape with the whole trail, leaves a trail redrawn since alone,
 * and adds Sand Run's Parcours Trail once.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import pg from 'pg';

const adminPool = new pg.Pool();
// PostGIS lives in public; the probe's own pois table is found first.
const probe = new pg.Pool({ options: '-c search_path=spree_shapes_probe,public' });
const migration = await readFile(new URL('../migrations/103_spree_trail_shapes.sql', import.meta.url), 'utf8');

const MILE_IN_DEGREES_NORTH = 1 / 69.05;
// A straight line north from the valley, the given number of miles long.
const lineOf = (miles) => JSON.stringify({
  type: 'LineString',
  coordinates: [[-81.57, 41.13], [-81.57, 41.13 + miles * MILE_IN_DEGREES_NORTH]]
});

const addTrail = (name, miles) => probe.query(
  "INSERT INTO pois (name, poi_roles, geometry) VALUES ($1, ARRAY['trail'], $2::jsonb)",
  [name, lineOf(miles)]
);
const trail = async (name) => (await probe.query(
  `SELECT length_miles::float AS miles, geometry,
          ST_Length(ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326)::geography) / 1609.344 AS drawn
   FROM pois WHERE name = $1`, [name]
)).rows;

beforeEach(async () => {
  await adminPool.query('DROP SCHEMA IF EXISTS spree_shapes_probe CASCADE');
  await adminPool.query('CREATE SCHEMA spree_shapes_probe');
  await probe.query(`CREATE TABLE pois (
    id serial PRIMARY KEY, name text, brief_description text, poi_roles text[], primary_activities text,
    length_miles numeric, difficulty text, property_owner text, owner_id integer, geometry jsonb,
    more_info_link text, deleted boolean, updated_at timestamp)`);
});

afterAll(async () => {
  await probe.end();
  await adminPool.query('DROP SCHEMA IF EXISTS spree_shapes_probe CASCADE');
  await adminPool.end();
});

describe('migration 103 (complete shapes for the spree trails)', () => {
  it('replaces the incomplete shape with the whole trail, shared stretches included', async () => {
    await addTrail('Seneca Trail', 0.75);
    await addTrail('Adam Run Trail', 1.7);

    await probe.query(migration);

    const [seneca] = await trail('Seneca Trail');
    expect(seneca.miles).toBe(1.1);
    expect(seneca.drawn).toBeCloseTo(1.14, 1);
    const [adamRun] = await trail('Adam Run Trail');
    expect(adamRun.miles).toBe(3.3);
    expect(adamRun.drawn).toBeCloseTo(3.26, 1);
  });

  it('keeps the Goodyear Heights trail as Parcours Trail and adds the Sand Run one once', async () => {
    await addTrail('Parcours Trail', 2.82);

    await probe.query(migration);
    await probe.query(migration);

    const [goodyear] = await trail('Parcours Trail');
    expect(goodyear.drawn).toBeCloseTo(1.73, 1);
    const sandRun = await trail('Parcours Trail (Sand Run)');
    expect(sandRun).toHaveLength(1);
    expect(sandRun[0].drawn).toBeCloseTo(1.49, 1);
  });

  it('leaves a trail that has been redrawn since as it is', async () => {
    await addTrail('Seneca Trail', 1.3);

    await probe.query(migration);

    const [seneca] = await trail('Seneca Trail');
    expect(seneca.miles).toBeNull();
    expect(seneca.geometry).toEqual(JSON.parse(lineOf(1.3)));
  });
});
