/**
 * Email sign-in end to end against real PostgreSQL (spec 045): the real auth
 * router with real sessions and passport, a scratch schema, and a fake mailer
 * that captures what would have been emailed.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import pg from 'pg';
import request from 'supertest';
import { createAuthRouter } from '../routes/auth.js';
import { configurePassport } from '../config/passport.js';
import { MAX_CODE_ATTEMPTS } from '../services/emailLogin.js';

// Connection comes from the PG* environment the test container sets (run.sh);
// every connection resolves unqualified tables to the probe schema first.
const adminPool = new pg.Pool();
const pool = new pg.Pool({ options: '-c search_path=email_login_probe,public' });

const migrationSql = await readFile(new URL('../migrations/092_email_login_tokens.sql', import.meta.url), 'utf8');

function linkToken(message) {
  const match = message.text.match(/\/signin#token=([A-Za-z0-9_-]+)/);
  expect(match, message.text).not.toBeNull();
  return match[1];
}

function codeOf(message) {
  return message.text.match(/code: (\d{6})/)[1];
}

let mailer;
// Each app gets a fresh fake mailer that records what would have been emailed.
function makeApp() {
  const sent = [];
  mailer = {
    enabled: true,
    sent,
    async send(message) { sent.push(message); return `<${sent.length}@test>`; }
  };
  configurePassport(pool);
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use('/auth', createAuthRouter(pool, { mailer }));
  return app;
}

beforeEach(async () => {
  await adminPool.query('DROP SCHEMA IF EXISTS email_login_probe CASCADE');
  await adminPool.query('CREATE SCHEMA email_login_probe');
  await pool.query(`
    CREATE TABLE users (
      id serial PRIMARY KEY, email varchar(255) UNIQUE, name text, picture_url text,
      oauth_provider varchar(50) NOT NULL, oauth_provider_id varchar(255) NOT NULL,
      is_admin boolean DEFAULT false, role text DEFAULT 'viewer', oauth_credentials jsonb,
      preferences jsonb, last_login_at timestamptz,
      UNIQUE (oauth_provider, oauth_provider_id));
    CREATE TABLE user_identities (
      id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider varchar(50) NOT NULL, provider_id varchar(255) NOT NULL, UNIQUE (provider, provider_id));
    CREATE TABLE user_poi_favorites (user_id int, poi_id int, created_at timestamptz DEFAULT now());
    CREATE TABLE user_visits (user_id int, poi_id int, visited_at timestamptz DEFAULT now());
    CREATE TABLE admin_settings (key text PRIMARY KEY, value text);
  `);
  await pool.query(migrationSql);
});

afterAll(async () => {
  await adminPool.query('DROP SCHEMA IF EXISTS email_login_probe CASCADE');
  await pool.end();
  await adminPool.end();
});

describe('email sign-in', () => {
  it('signs in with the emailed link, creating the account, and the link works once', async () => {
    const agent = request.agent(makeApp());
    const start = await agent.post('/auth/email/start').send({ email: '  Hiker@Example.COM ' }).expect(200);
    expect(start.body.message).toMatch(/on the way/);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('hiker@example.com');

    const [message] = mailer.sent;
    const token = linkToken(message);
    await agent.post('/auth/email/verify').send({ token }).expect(200);
    const me = await agent.get('/auth/user').expect(200);
    expect(me.body.email).toBe('hiker@example.com');

    await request(makeApp()).post('/auth/email/verify').send({ token }).expect(400);

    const stored = await pool.query('SELECT token_hash, code_hash FROM email_login_tokens');
    expect(stored.rows[0].token_hash).not.toBe(token);
    expect(stored.rows[0].code_hash).not.toBe(codeOf(message));
  });

  it('signs in with the code and links to an existing Google account by email', async () => {
    const google = await pool.query(
      `INSERT INTO users (email, name, oauth_provider, oauth_provider_id) VALUES ('hiker@example.com', 'Hiker', 'google', 'g-1') RETURNING id`
    );
    const agent = request.agent(makeApp());
    await agent.post('/auth/email/start').send({ email: 'hiker@example.com' }).expect(200);
    await agent.post('/auth/email/verify').send({ email: 'HIKER@example.com', code: codeOf(mailer.sent[0]) }).expect(200);

    const me = await agent.get('/auth/user').expect(200);
    expect(me.body.id).toBe(google.rows[0].id);
    const identities = await pool.query('SELECT provider FROM user_identities ORDER BY provider');
    expect(identities.rows.map((r) => r.provider)).toEqual(['email']);
    const users = await pool.query('SELECT count(*)::int AS n FROM users');
    expect(users.rows[0].n).toBe(1);
  });

  it('stops accepting codes after too many wrong guesses, even the right one', async () => {
    const app = makeApp();
    await request(app).post('/auth/email/start').send({ email: 'hiker@example.com' }).expect(200);
    const right = codeOf(mailer.sent[0]);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) {
      await request(app).post('/auth/email/verify').send({ email: 'hiker@example.com', code: wrong }).expect(400);
    }
    await request(app).post('/auth/email/verify').send({ email: 'hiker@example.com', code: right }).expect(400);
  });

  it('lets only one of two simultaneous correct codes through', async () => {
    const app = makeApp();
    await request(app).post('/auth/email/start').send({ email: 'hiker@example.com' }).expect(200);
    const code = codeOf(mailer.sent[0]);
    const results = await Promise.all([1, 2, 3].map(() =>
      request(app).post('/auth/email/verify').send({ email: 'hiker@example.com', code })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
  });

  it('uses the admin-set lifetime, defaults to 30 minutes, and clamps out-of-range values', async () => {
    const lifetimes = [];
    for (const setting of [null, '45', '500']) {
      await pool.query('DELETE FROM admin_settings');
      if (setting) await pool.query(`INSERT INTO admin_settings (key, value) VALUES ('email_login_ttl_minutes', $1)`, [setting]);
      const app = makeApp();
      await request(app).post('/auth/email/start').send({ email: `ttl${lifetimes.length}@example.com` }).expect(200);
      const row = await pool.query(
        `SELECT round(extract(epoch FROM expires_at - created_at) / 60)::int AS minutes
         FROM email_login_tokens ORDER BY id DESC LIMIT 1`);
      lifetimes.push(row.rows[0].minutes);
      expect(mailer.sent[0].text).toContain(`expire in ${row.rows[0].minutes} minutes`);
    }
    expect(lifetimes).toEqual([30, 45, 60]);
  });

  it('rejects an expired link', async () => {
    const app = makeApp();
    await request(app).post('/auth/email/start').send({ email: 'hiker@example.com' }).expect(200);
    await pool.query(`UPDATE email_login_tokens SET expires_at = NOW() - INTERVAL '1 minute'`);
    await request(app).post('/auth/email/verify').send({ token: linkToken(mailer.sent[0]) }).expect(400);
  });

  it('only the newest request\'s code works', async () => {
    const app = makeApp();
    await request(app).post('/auth/email/start').send({ email: 'hiker@example.com' }).expect(200);
    await request(app).post('/auth/email/start').send({ email: 'hiker@example.com' }).expect(200);
    const [older, newer] = mailer.sent.map(codeOf);
    if (older !== newer) {
      await request(app).post('/auth/email/verify').send({ email: 'hiker@example.com', code: older }).expect(400);
    }
    await request(app).post('/auth/email/verify').send({ email: 'hiker@example.com', code: newer }).expect(200);
  });

  it('rate-limits repeated requests for one address regardless of spelling', async () => {
    const app = makeApp();
    for (const spelling of ['a@example.com', 'A@example.com', ' a@EXAMPLE.com']) {
      await request(app).post('/auth/email/start').send({ email: spelling }).expect(200);
    }
    await request(app).post('/auth/email/start').send({ email: 'a@example.com' }).expect(429);
    expect(mailer.sent).toHaveLength(3);
  });

  it('rate-limits one client across many addresses', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/auth/email/start').send({ email: `person${i}@example.com` }).expect(200);
    }
    await request(app).post('/auth/email/start').send({ email: 'person5@example.com' }).expect(429);
    expect(mailer.sent).toHaveLength(5);
  });

  it('rejects malformed addresses and reports 502 when the mail cannot be sent', async () => {
    const app = makeApp();
    await request(app).post('/auth/email/start').send({ email: 'not-an-email' }).expect(400);
    mailer.send = async () => { throw new Error('relay down'); };
    const res = await request(app).post('/auth/email/start').send({ email: 'hiker@example.com' }).expect(502);
    expect(res.body.error).toMatch(/couldn't send/);
  });
});
