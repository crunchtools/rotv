/**
 * Migration 100 against a real database: it adds the Mandel Community Trail once,
 * moves only the opening coverage that sits under the POI it was first filed under,
 * and a re-run (every boot) leaves a later admin reassignment alone.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import pg from 'pg';

const adminPool = new pg.Pool();
// public stays on the path for the PostGIS type and functions the migration uses.
const probe = new pg.Pool({ options: '-c search_path=mandel_trail_probe,public' });
const migration = await readFile(new URL('../migrations/100_add_mandel_community_trail.sql', import.meta.url), 'utf8');

const NEWS5 = 'https://www.news5cleveland.com/news/local-news/oh-cuyahoga/cleveland-metroparks-opens-mandel-community-trail-connecting-lakefront-to-city-neighborhoods';
const COUNTY = 'https://cuyahogacounty.gov/county-news/county-news-detail/2026/09/22/mandel-community-trail-opens--creating-new-connection-to-cleveland-s-lakefront';
const SPECTRUM = 'https://spectrumnews1.com/oh/dayton/news/2026/09/24/new-trail-increases-access-to-cleveland-s-east-side-lakefront';
const METROPARKS = 'https://www.clevelandmetroparks.com/news-press/transformative-mandel-community-trail-opens-creating-new-connection-to-cleveland-s-lakefront';
const UNRELATED = 'https://example.com/edgewater-beach-reopens';

const filedUnder = async () => {
  const news = await probe.query(
    `SELECT n.id, p.name FROM poi_news n JOIN pois p ON p.id = n.poi_id ORDER BY n.id`
  );
  return Object.fromEntries(news.rows.map(row => [row.id, row.name]));
};

beforeEach(async () => {
  await adminPool.query('DROP SCHEMA IF EXISTS mandel_trail_probe CASCADE');
  await adminPool.query('CREATE SCHEMA mandel_trail_probe');
  await probe.query(`
    CREATE TABLE pois (
      id serial PRIMARY KEY, name text UNIQUE, brief_description text, poi_roles text[],
      latitude numeric, longitude numeric, primary_activities text, length_miles numeric,
      surface text, is_bike_friendly boolean, property_owner text, owner_id int,
      geometry jsonb, more_info_link text, deleted boolean, geom geometry(Point, 4326)
    );
    CREATE TABLE poi_news (id int PRIMARY KEY, poi_id int, source_url text);
    INSERT INTO pois (id, name, poi_roles) VALUES
      (1, 'Cleveland Metroparks', '{organization}'),
      (2, 'Cleveland Lakefront Bikeway', '{trail}'),
      (3, 'East 55th Street Marina', '{point}'),
      (4, 'Edgewater Park', '{point}');
    SELECT setval('pois_id_seq', 4);
    INSERT INTO poi_news VALUES
      (1, 2, '${NEWS5}'),
      (2, 3, '${COUNTY}'),
      (3, 1, '${SPECTRUM}'),
      (4, 1, '${METROPARKS}'),
      (5, 4, '${SPECTRUM}'),
      (6, 1, '${UNRELATED}');
  `);
});

afterAll(async () => {
  await probe.end();
  await adminPool.query('DROP SCHEMA IF EXISTS mandel_trail_probe CASCADE');
  await adminPool.end();
});

describe('migration 100 (Mandel Community Trail)', () => {
  it('adds the trail with its owner and point geometry', async () => {
    await probe.query(migration);

    const trail = await probe.query(
      `SELECT owner_id, poi_roles, geometry->>'type' AS shape,
              ST_AsText(geom) AS geom
       FROM pois WHERE name = 'Mandel Community Trail'`
    );
    expect(trail.rows).toEqual([
      { owner_id: 1, poi_roles: ['trail'], shape: 'LineString', geom: 'POINT(-81.67371 41.51928)' }
    ]);
  });

  it('moves only the listed articles filed under the listed POI', async () => {
    await probe.query(migration);

    expect(await filedUnder()).toEqual({
      1: 'Mandel Community Trail',
      2: 'Mandel Community Trail',
      3: 'Mandel Community Trail',
      4: 'Mandel Community Trail',
      5: 'Edgewater Park',
      6: 'Cleveland Metroparks'
    });
  });

  it('changes nothing on a re-run, even after an admin files an article back', async () => {
    await probe.query(migration);
    await probe.query(`UPDATE poi_news SET poi_id = 1 WHERE id = 4`);
    await probe.query(`UPDATE poi_news SET poi_id = 4 WHERE id = 1`);
    await probe.query(`UPDATE pois SET brief_description = 'Edited by an admin' WHERE name = 'Mandel Community Trail'`);

    await probe.query(migration);

    const trails = await probe.query(`SELECT brief_description FROM pois WHERE name = 'Mandel Community Trail'`);
    expect(trails.rows).toEqual([{ brief_description: 'Edited by an admin' }]);
    expect(await filedUnder()).toEqual({
      1: 'Edgewater Park',
      2: 'Mandel Community Trail',
      3: 'Mandel Community Trail',
      4: 'Cleveland Metroparks',
      5: 'Edgewater Park',
      6: 'Cleveland Metroparks'
    });
  });

  it('leaves news alone when the trail already exists', async () => {
    await probe.query(`INSERT INTO pois (name, poi_roles) VALUES ('Mandel Community Trail', '{trail}')`);
    await probe.query(migration);

    expect(Object.values(await filedUnder())).not.toContain('Mandel Community Trail');
  });
});
