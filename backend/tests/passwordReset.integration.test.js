/**
 * "Forgot password?" end to end against real PostgreSQL (specs 045, 046): the
 * real auth router with sessions and passport, a scratch schema built from the
 * real migrations, and a fake mailer that captures what would have been sent.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { readFile } from 'fs/promises';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import pg from 'pg';
import request from 'supertest';
import { createAuthRouter } from '../routes/auth.js';
import { configurePassport } from '../config/passport.js';
import { hashPassword } from '../services/passwords.js';

const OLD = 'my old forgotten passphrase';
const NEW = 'a brand new passphrase';

const adminPool = new pg.Pool();
const pool = new pg.Pool({ options: '-c search_path=reset_probe,public' });
const migrations = await Promise.all(
  ['092_email_login_tokens.sql', '093_signup_accounts.sql', '094_email_link_only.sql'].map((name) =>
    readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
);

let mailer;
function makeApp() {
  const sent = [];
  mailer = { enabled: true, sent, async send(message) { sent.push(message); return `<${sent.length}@test>`; } };
  configurePassport(pool);
  const app = express();
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use('/auth', createAuthRouter(pool, { mailer }));
  return app;
}

// "Forgot password?" answers before the email is handed off (so timing reveals
// nothing); wait for the fake mailer to catch up.
async function mailCount(n) {
  await vi.waitFor(() => expect(mailer.sent).toHaveLength(n));
}

function resetToken(message) {
  const match = message.text.match(/\/reset-password#token=([A-Za-z0-9_-]+)/);
  expect(match, message.text).not.toBeNull();
  return match[1];
}

async function addAccount(email, { admin = false } = {}) {
  const created = await pool.query(
    `INSERT INTO users (email, name, oauth_provider, oauth_provider_id, is_admin, role, email_verified_at, signup_completed_at)
     VALUES ($1, 'Hiker', 'password', $1, $2, $3, NOW(), NOW()) RETURNING id`,
    [email, admin, admin ? 'admin' : 'viewer']
  );
  await pool.query('INSERT INTO user_passwords (user_id, hash) VALUES ($1, $2)', [created.rows[0].id, await hashPassword(OLD)]);
  return created.rows[0].id;
}

beforeEach(async () => {
  // No breached passwords.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' })));
  await adminPool.query('DROP SCHEMA IF EXISTS reset_probe CASCADE');
  await adminPool.query('CREATE SCHEMA reset_probe');
  await pool.query(`
    CREATE TABLE users (
      id serial PRIMARY KEY, email varchar(255) UNIQUE, name varchar(255), picture_url text,
      oauth_provider varchar(50) NOT NULL, oauth_provider_id varchar(255) NOT NULL,
      is_admin boolean DEFAULT false, role varchar(20) DEFAULT 'viewer', oauth_credentials jsonb,
      preferences jsonb DEFAULT '{}', created_at timestamp DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp DEFAULT CURRENT_TIMESTAMP, last_login_at timestamp,
      UNIQUE (oauth_provider, oauth_provider_id));
    CREATE TABLE user_identities (
      id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider varchar(50) NOT NULL, provider_id varchar(255) NOT NULL, UNIQUE (provider, provider_id));
    CREATE TABLE user_poi_favorites (user_id int, poi_id int, created_at timestamptz DEFAULT now());
    CREATE TABLE user_visits (user_id int, poi_id int, visited_at timestamptz DEFAULT now());
    CREATE TABLE admin_settings (key text PRIMARY KEY, value text);
    CREATE TABLE sessions (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL);
  `);
  for (const sql of migrations) await pool.query(sql);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  // End the app's pool first: it waits for queries the routes started after
  // answering (mail handoff), which otherwise deadlock with the DROP (#729)
  await pool.end();
  await adminPool.query('DROP SCHEMA IF EXISTS reset_probe CASCADE');
  await adminPool.end();
});

describe('forgot password', () => {
  it('emails one link, no code; the new password signs in and the old one stops working', async () => {
    await addAccount('hiker@example.com');
    const agent = request.agent(makeApp());
    const forgot = await agent.post('/auth/password/forgot').send({ email: '  Hiker@Example.COM ' }).expect(200);
    expect(forgot.body.message).toMatch(/If there's an account/);
    await mailCount(1);
    expect(mailer.sent).toHaveLength(1);
    const [message] = mailer.sent;
    expect(message.subject).toBe('Reset your Roots of the Valley password');
    expect(message.text).not.toMatch(/\d{6}/);
    expect(message.text).toContain('expires in 30 minutes');

    await agent.post('/auth/password/reset').send({ token: resetToken(message), password: NEW }).expect(200);
    expect((await agent.get('/auth/user')).body.email).toBe('hiker@example.com');

    const app = makeApp();
    await request(app).post('/auth/password/login').send({ email: 'hiker@example.com', password: OLD }).expect(401);
    await request(app).post('/auth/password/login').send({ email: 'hiker@example.com', password: NEW }).expect(200);
  });

  it('never signs anyone in from the link alone, and the link works once', async () => {
    await addAccount('hiker@example.com');
    const app = makeApp();
    await request(app).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    await mailCount(1);
    const token = resetToken(mailer.sent[0]);

    // A rejected password doesn't use up the link.
    const weak = await request(app).post('/auth/password/reset').send({ token, password: 'short' }).expect(400);
    expect(weak.body.error).toMatch(/at least 12/);
    await request(app).post('/auth/password/reset').send({ token, password: NEW }).expect(200);
    await request(app).post('/auth/password/reset').send({ token, password: 'yet another passphrase' }).expect(400);
  });

  it('voids the other reset links and ends the account\'s other sessions', async () => {
    const id = await addAccount('hiker@example.com');
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ('stolen', $1, NOW() + INTERVAL '1 day')`,
      [JSON.stringify({ passport: { user: id } })]
    );
    const app = makeApp();
    await request(app).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    await mailCount(1);
    await request(app).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    await mailCount(2);
    const [older, newer] = mailer.sent.map(resetToken);

    await request(app).post('/auth/password/reset').send({ token: newer, password: NEW }).expect(200);
    await request(app).post('/auth/password/reset').send({ token: older, password: 'someone else passphrase' }).expect(400);
    expect((await pool.query(`SELECT 1 FROM sessions WHERE sid = 'stolen'`)).rows).toHaveLength(0);
  });

  it('refuses a reset link issued before the account became an admin', async () => {
    await addAccount('hiker@example.com');
    const app = makeApp();
    await request(app).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    await mailCount(1);
    await pool.query(`UPDATE users SET is_admin = TRUE, role = 'admin'`);
    await request(app).post('/auth/password/reset').send({ token: resetToken(mailer.sent[0]), password: NEW }).expect(400);
    await request(app).post('/auth/password/login').send({ email: 'hiker@example.com', password: NEW }).expect(401);
  });

  it('gives the same answer for unknown and admin addresses, and emails neither', async () => {
    await addAccount('boss@example.com', { admin: true });
    const app = makeApp();
    const unknown = await request(app).post('/auth/password/forgot').send({ email: 'nobody@example.com' }).expect(200);
    const admin = await request(app).post('/auth/password/forgot').send({ email: 'boss@example.com' }).expect(200);
    expect(admin.body).toEqual(unknown.body);
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect(mailer.sent).toHaveLength(0);
  });

  it('rejects an expired link and a confirmation link used as a reset', async () => {
    await addAccount('hiker@example.com');
    const app = makeApp();
    await request(app).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    await mailCount(1);
    await pool.query(`UPDATE email_login_tokens SET expires_at = NOW() - INTERVAL '1 minute'`);
    await request(app).post('/auth/password/reset').send({ token: resetToken(mailer.sent[0]), password: NEW }).expect(400);

    // A reset token can't confirm an email either: each link only does its own job.
    await request(app).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    await mailCount(2);
    await request(app).post('/auth/email/verify').send({ token: resetToken(mailer.sent[1]) }).expect(400);
  });

  it('uses the admin-set link lifetime, defaulting to 30 and clamping to 5-60', async () => {
    await addAccount('hiker@example.com');
    for (const [setting, expected] of [[null, 30], ['soon', 30], ['45', 45], ['1', 5], ['500', 60]]) {
      await pool.query('DELETE FROM admin_settings');
      await pool.query('DELETE FROM email_login_tokens');
      if (setting) await pool.query(`INSERT INTO admin_settings (key, value) VALUES ('email_login_ttl_minutes', $1)`, [setting]);
      await request(makeApp()).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
      await mailCount(1);
      const row = await pool.query(
        `SELECT round(extract(epoch FROM expires_at - created_at) / 60)::int AS minutes FROM email_login_tokens`);
      expect(row.rows[0].minutes).toBe(expected);
      expect(mailer.sent[0].text).toContain(`expires in ${expected} minutes`);
    }
  });

  it('stores only a digest of the emailed link', async () => {
    await addAccount('hiker@example.com');
    await request(makeApp()).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    await mailCount(1);
    const token = resetToken(mailer.sent[0]);
    const row = (await pool.query('SELECT token_hash, code_hash FROM email_login_tokens')).rows[0];
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toBe(token);
    expect(row.code_hash).toBeNull();
  });

  it('rate-limits one client across many addresses', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/auth/password/forgot').send({ email: `person${i}@example.com` }).expect(200);
    }
    await request(app).post('/auth/password/forgot').send({ email: 'person5@example.com' }).expect(429);
  });

  it('rate-limits requests for one address regardless of spelling', async () => {
    await addAccount('a@example.com');
    const app = makeApp();
    for (const spelling of ['a@example.com', 'A@example.com', ' a@EXAMPLE.com']) {
      await request(app).post('/auth/password/forgot').send({ email: spelling }).expect(200);
    }
    await request(app).post('/auth/password/forgot').send({ email: 'a@example.com' }).expect(429);
    await mailCount(3);
  });

  it('answers before the email is handed off, so timing reveals nothing', async () => {
    await addAccount('hiker@example.com');
    const app = makeApp();
    let release;
    mailer.send = () => new Promise((resolve) => { release = resolve; });
    const res = await request(app).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    expect(res.body.message).toMatch(/If there's an account/);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release('<late@test>');
  });

  it('still answers the same when the email cannot be sent, and rejects malformed addresses', async () => {
    await addAccount('hiker@example.com');
    const app = makeApp();
    await request(app).post('/auth/password/forgot').send({ email: 'not-an-email' }).expect(400);
    mailer.send = async () => { throw new Error('relay down'); };
    const res = await request(app).post('/auth/password/forgot').send({ email: 'hiker@example.com' }).expect(200);
    expect(res.body.message).toMatch(/If there's an account/);
  });
});
