/**
 * Account deletion against real PostgreSQL and the live app (#700).
 *
 * Migration 091 + deleteUserAccount run in a scratch schema that mirrors the
 * shapes that matter: a per-user CASCADE table, a NO ACTION contribution
 * reference, sessions, and newsletter rows. The legal-page cases hit the
 * running app.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import pg from 'pg';
import request from 'supertest';
import { deleteUserAccount } from '../services/accountDeletion.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

// Connection comes from the PG* environment the test container sets (run.sh).
const pool = new pg.Pool();

const migrationSql = await readFile(new URL('../migrations/091_user_references_set_null.sql', import.meta.url), 'utf8');

// Hands deleteUserAccount clients whose search_path puts the probe schema first.
const probePool = {
  async connect() {
    const client = await pool.connect();
    await client.query('SET search_path TO account_deletion_probe, public');
    const release = client.release.bind(client);
    client.release = () => {
      client.query('RESET search_path').finally(() => release());
    };
    return client;
  }
};

async function inProbe(sql) {
  const client = await probePool.connect();
  try {
    return await client.query(sql);
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await pool.query('DROP SCHEMA IF EXISTS account_deletion_probe CASCADE');
  await pool.query('CREATE SCHEMA account_deletion_probe');
  await inProbe(`
    CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE);
    CREATE TABLE user_poi_favorites (user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, poi_id int);
    CREATE TABLE poi_news (id serial PRIMARY KEY, title text, submitted_by int REFERENCES users(id));
    CREATE TABLE newsletter_subscriptions (id serial PRIMARY KEY, email text NOT NULL);
    CREATE TABLE sessions (sid text PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL);
    INSERT INTO users (id, email) VALUES (1, 'leaving@example.com'), (2, 'staying@example.com');
    INSERT INTO user_poi_favorites VALUES (1, 10), (2, 20);
    INSERT INTO poi_news (title, submitted_by) VALUES ('Trail reopens', 1), ('Bridge closed', 2);
    INSERT INTO newsletter_subscriptions (email) VALUES ('Leaving@Example.com'), ('staying@example.com');
    INSERT INTO sessions VALUES
      ('s1', '{"passport":{"user":1}}', now() + interval '1 day'),
      ('s2', '{"passport":{"user":2}}', now() + interval '1 day');
  `);
});

afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS account_deletion_probe CASCADE');
  await pool.end();
});

describe('migration 091 + deleteUserAccount', () => {
  it('without the migration, a contribution reference blocks deletion and nothing changes', async () => {
    await expect(deleteUserAccount(probePool, 1)).rejects.toThrow(/foreign key/);
    const users = await inProbe('SELECT count(*)::int AS n FROM users');
    expect(users.rows[0].n).toBe(2);
  });

  it('converts contribution references to SET NULL and is a no-op on rerun', async () => {
    await inProbe(migrationSql);
    await inProbe(migrationSql);
    const actions = await inProbe(`
      SELECT cl.relname AS tbl, con.confdeltype::text AS action
      FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid
      WHERE con.contype = 'f' AND con.confrelid = 'users'::regclass ORDER BY 1`);
    expect(actions.rows).toEqual([
      { tbl: 'poi_news', action: 'n' },
      { tbl: 'user_poi_favorites', action: 'c' }
    ]);
  });

  it('deletes only the target user and their personal data, keeping contributions detached', async () => {
    await inProbe(migrationSql);
    expect(await deleteUserAccount(probePool, 1)).toBe(true);

    const snapshot = await inProbe(`
      SELECT
        (SELECT array_agg(id ORDER BY id) FROM users) AS users,
        (SELECT array_agg(user_id ORDER BY user_id) FROM user_poi_favorites) AS fav_owners,
        (SELECT json_agg(json_build_object('title', title, 'by', submitted_by) ORDER BY id) FROM poi_news) AS news,
        (SELECT array_agg(email ORDER BY email) FROM newsletter_subscriptions) AS newsletter,
        (SELECT array_agg(sid ORDER BY sid) FROM sessions) AS sessions`);
    expect(snapshot.rows[0]).toEqual({
      users: [2],
      fav_owners: [2],
      news: [{ title: 'Trail reopens', by: null }, { title: 'Bridge closed', by: 2 }],
      newsletter: ['staying@example.com'],
      sessions: ['s2']
    });
  });

  it('returns false for a user that does not exist', async () => {
    expect(await deleteUserAccount(probePool, 999)).toBe(false);
  });
});

describe('server-rendered legal pages', () => {
  for (const [path, title] of [['/privacy', 'Privacy Policy'], ['/data-deletion', 'Deleting Your Data']]) {
    it(`${path} carries a titled <noscript> copy for crawlers`, async () => {
      const res = await request(BASE_URL).get(path).expect(200);
      expect(res.text).toContain(`<title>${title} | Roots of The Valley</title>`);
      expect(res.text).toMatch(/<noscript><main><h1>[^<]+<\/h1>/);
      expect(res.text).toContain('<div id="root"></div>');
    });
  }

  it('leaves other pages as the plain SPA shell', async () => {
    const res = await request(BASE_URL).get('/settings').expect(200);
    expect(res.text).not.toContain('<noscript><main>');
  });
});
