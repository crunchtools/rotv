/**
 * Sign-up, passwords and passkeys end to end against real PostgreSQL
 * (spec 046): the real /auth router with sessions and passport, a scratch
 * schema built from the real migrations, a fake mailer, and a software
 * passkey authenticator.
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
import { findOrCreateUser } from '../config/userAccount.js';
import { deleteStaleUnconfirmedAccounts } from '../services/unconfirmedCleanup.js';
import { deleteUserAccount } from '../services/accountDeletion.js';
import { addSubscriber } from '../services/buttondownClient.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';

vi.mock('../services/buttondownClient.js', () => ({ addSubscriber: vi.fn(async () => ({ status: 'subscribed' })) }));

const ORIGIN = new URL(process.env.FRONTEND_URL || 'http://localhost:8080');
const STRONG = 'correct horse battery staple';

const adminPool = new pg.Pool();
const pool = new pg.Pool({ options: '-c search_path=signup_probe,public' });
const migrations = await Promise.all(
  ['092_email_login_tokens.sql', '093_signup_accounts.sql'].map((name) =>
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

function signupBody(overrides = {}) {
  return {
    name: 'Jane Hiker',
    username: 'trailjane',
    displayPreference: 'username',
    email: 'jane@example.com',
    method: 'password',
    password: STRONG,
    ageConfirmed: true,
    termsAccepted: true,
    newsletter: true,
    ...overrides
  };
}

function linkToken(message) {
  return message.text.match(/\/signin#token=([A-Za-z0-9_-]+)/)[1];
}

// No breached passwords unless a test says otherwise.
function stubBreachApi(body = '0000000000000000000000000000000000A:1') {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => body })));
}

beforeEach(async () => {
  stubBreachApi();
  vi.mocked(addSubscriber).mockClear();
  await adminPool.query('DROP SCHEMA IF EXISTS signup_probe CASCADE');
  await adminPool.query('CREATE SCHEMA signup_probe');
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
    CREATE TABLE newsletter_subscriptions (id serial PRIMARY KEY, email varchar(255) NOT NULL,
      subscribed_at timestamptz DEFAULT now(), source varchar(50), created_at timestamptz DEFAULT now());
  `);
  for (const sql of migrations) await pool.query(sql);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await adminPool.query('DROP SCHEMA IF EXISTS signup_probe CASCADE');
  await pool.end();
  await adminPool.end();
});

describe('sign-up with a password', () => {
  it('creates a usable, unconfirmed account and emails a 7-day confirmation', async () => {
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody()).expect(201);

    const me = await agent.get('/auth/user').expect(200);
    expect(me.body).toMatchObject({
      email: 'jane@example.com', name: 'Jane Hiker', username: 'trailjane',
      displayName: 'trailjane', emailVerified: false, needsSignupCompletion: false
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].subject).toMatch(/Confirm your Roots of the Valley email/);
    expect(mailer.sent[0].text).toContain('expire in 7 days');

    const stored = await pool.query('SELECT hash FROM user_passwords');
    expect(stored.rows[0].hash).toMatch(/^scrypt\$/);
    expect(stored.rows[0].hash).not.toContain(STRONG);
    // The newsletter box waits for confirmation.
    expect(addSubscriber).not.toHaveBeenCalled();
  });

  it('confirms by the emailed link, keeps the password, and releases the newsletter opt-in', async () => {
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody()).expect(201);
    // Read the token before makeApp() swaps in a fresh mailer.
    const token = linkToken(mailer.sent[0]);
    const verify = await request(makeApp()).post('/auth/email/verify').send({ token }).expect(200);
    expect(verify.body.confirmed).toBe(true);

    const user = await pool.query('SELECT email_verified_at, newsletter_opt_in FROM users');
    expect(user.rows[0].email_verified_at).not.toBeNull();
    expect(user.rows[0].newsletter_opt_in).toBe(false);
    expect(addSubscriber).toHaveBeenCalledWith('jane@example.com', pool);
    expect((await pool.query('SELECT 1 FROM user_passwords')).rows).toHaveLength(1);
  });

  it('logs in with the password, and a wrong password or unknown email get the same answer', async () => {
    await request(makeApp()).post('/auth/signup').send(signupBody()).expect(201);
    const app = makeApp();

    const agent = request.agent(app);
    await agent.post('/auth/password/login').send({ email: ' JANE@example.com', password: STRONG }).expect(200);
    expect((await agent.get('/auth/user')).body.email).toBe('jane@example.com');

    const wrong = await request(app).post('/auth/password/login').send({ email: 'jane@example.com', password: 'not the one at all' });
    const unknown = await request(app).post('/auth/password/login').send({ email: 'nobody@example.com', password: STRONG });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('rate-limits password guesses per address', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/auth/password/login').send({ email: 'jane@example.com', password: `guess number ${i}!` }).expect(401);
    }
    await request(app).post('/auth/password/login').send({ email: 'jane@example.com', password: STRONG }).expect(429);
  });

  it('enforces the password policy, including breached passwords', async () => {
    const app = makeApp();
    const short = await request(app).post('/auth/signup').send(signupBody({ password: 'short' })).expect(400);
    expect(short.body.error).toMatch(/at least 12/);

    // SHA-1 of the password, minus the 5-character prefix, listed as seen 42 times.
    const crypto = await import('crypto');
    const suffix = crypto.createHash('sha1').update(STRONG).digest('hex').toUpperCase().slice(5);
    stubBreachApi(`${suffix}:42`);
    const breached = await request(app).post('/auth/signup').send(signupBody({ email: 'b@example.com', username: 'bee' })).expect(400);
    expect(breached.body.error).toMatch(/data breach/);
  });

  it('requires the age and terms boxes', async () => {
    const res = await request(makeApp()).post('/auth/signup').send(signupBody({ termsAccepted: false })).expect(400);
    expect(res.body.error).toMatch(/13 or older/);
    expect((await pool.query('SELECT 1 FROM users')).rows).toHaveLength(0);
  });

  it('treats usernames as unique regardless of case', async () => {
    await request(makeApp()).post('/auth/signup').send(signupBody()).expect(201);
    const app = makeApp();
    const taken = await request(app).get('/auth/username-available?username=TrailJane').expect(200);
    expect(taken.body.available).toBe(false);
    await request(app).post('/auth/signup')
      .send(signupBody({ email: 'other@example.com', username: 'TRAILJANE' })).expect(409);
    const reserved = await request(app).get('/auth/username-available?username=admin').expect(200);
    expect(reserved.body.error).toMatch(/reserved/);
  });

  it('refuses a second account for the same email', async () => {
    await request(makeApp()).post('/auth/signup').send(signupBody()).expect(201);
    const res = await request(makeApp()).post('/auth/signup')
      .send(signupBody({ username: 'someoneelse' })).expect(409);
    expect(res.body.error).toMatch(/already exists/);
  });
});

describe('passkeys', () => {
  it('signs up with a passkey, then signs in with it and no email', async () => {
    const authenticator = createSoftAuthenticator();
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody({ method: 'passkey', password: undefined })).expect(201);

    const options = (await agent.post('/auth/passkey/register/options').expect(200)).body;
    expect(options.rp.id).toBe(ORIGIN.hostname);
    expect(options.authenticatorSelection.residentKey).toBe('required');
    const registered = await agent.post('/auth/passkey/register/verify')
      .send({ response: authenticator.register(options, ORIGIN.origin), name: 'Phone' }).expect(201);
    expect(registered.body.passkey.name).toBe('Phone');

    const fresh = request.agent(makeApp());
    const loginOptions = (await fresh.post('/auth/passkey/login/options').expect(200)).body;
    await fresh.post('/auth/passkey/login/verify')
      .send({ response: authenticator.authenticate(loginOptions, ORIGIN.origin, ORIGIN.hostname) }).expect(200);
    expect((await fresh.get('/auth/user')).body.email).toBe('jane@example.com');

    const methods = (await fresh.get('/auth/methods').expect(200)).body;
    expect(methods.hasPassword).toBe(false);
    expect(methods.passkeys).toHaveLength(1);
    expect(methods.passkeys[0].lastUsedAt).not.toBeNull();
  });

  it('rejects a replayed sign-in response', async () => {
    const authenticator = createSoftAuthenticator();
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody({ method: 'passkey', password: undefined })).expect(201);
    const options = (await agent.post('/auth/passkey/register/options')).body;
    await agent.post('/auth/passkey/register/verify').send({ response: authenticator.register(options, ORIGIN.origin) }).expect(201);

    const fresh = request.agent(makeApp());
    const loginOptions = (await fresh.post('/auth/passkey/login/options')).body;
    const response = authenticator.authenticate(loginOptions, ORIGIN.origin, ORIGIN.hostname);
    await fresh.post('/auth/passkey/login/verify').send({ response }).expect(200);
    await fresh.post('/auth/passkey/login/verify').send({ response }).expect(401);
  });
});

describe('changing sign-in methods', () => {
  it('needs a sign-in within the last 15 minutes', async () => {
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody()).expect(201);
    await agent.put('/auth/password').send({ password: 'another long passphrase' }).expect(200);

    const later = Date.now() + 16 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const stale = await agent.put('/auth/password').send({ password: 'yet another passphrase' }).expect(403);
    expect(stale.body.reauth).toBe(true);
    await agent.delete('/auth/password').expect(403);
    await agent.post('/auth/passkey/register/options').expect(403);
  });

  it('never gives an admin account a password', async () => {
    const admin = await findOrCreateUser(pool, 'boss@example.com', 'email', { id: 'boss@example.com', emails: [{ value: 'boss@example.com' }] }, null);
    expect(admin.is_admin).toBe(true);
    const app = makeApp();
    const agent = request.agent(app);
    await agent.post('/auth/email/start').send({ email: 'boss@example.com' }).expect(200);
    process.env.ADMIN_EMAIL = 'boss@example.com';
    try {
      await agent.post('/auth/email/verify').send({ token: linkToken(mailer.sent[0]) }).expect(200);
      const res = await agent.put('/auth/password').send({ password: STRONG }).expect(403);
      expect(res.body.error).toMatch(/Admin accounts/);

      // A password that somehow exists (set before promotion) still can't sign an admin in.
      const { hashPassword } = await import('../services/passwords.js');
      await pool.query('INSERT INTO user_passwords (user_id, hash) VALUES ($1, $2)', [admin.id, await hashPassword(STRONG)]);
      await request(app).post('/auth/password/login').send({ email: 'boss@example.com', password: STRONG }).expect(401);
    } finally {
      delete process.env.ADMIN_EMAIL;
    }
  });
});

describe('account protection and cleanup', () => {
  it('lets the verified owner take over an unconfirmed sign-up made with their address', async () => {
    const squatter = request.agent(makeApp());
    await squatter.post('/auth/signup').send(signupBody({ email: 'owner@example.com' })).expect(201);

    const owner = request.agent(makeApp());
    await owner.post('/auth/email/start').send({ email: 'owner@example.com' }).expect(200);
    const signIn = mailer.sent.find((m) => m.subject.includes('sign-in code'));
    await owner.post('/auth/email/verify').send({ token: linkToken(signIn) }).expect(200);

    const me = (await owner.get('/auth/user')).body;
    expect(me.emailVerified).toBe(true);
    expect(me.notice).toBe('credentials_reset');
    expect((await pool.query('SELECT 1 FROM user_passwords')).rows).toHaveLength(0);
    expect((await pool.query('SELECT newsletter_opt_in FROM users')).rows[0].newsletter_opt_in).toBe(false);
    // The squatter's password no longer works.
    await request(makeApp()).post('/auth/password/login').send({ email: 'owner@example.com', password: STRONG }).expect(401);
  });

  it('sends accounts made outside the form to finish sign-up', async () => {
    const agent = request.agent(makeApp());
    await agent.post('/auth/email/start').send({ email: 'walker@example.com' }).expect(200);
    const verify = await agent.post('/auth/email/verify').send({ token: linkToken(mailer.sent[0]) }).expect(200);
    expect(verify.body.needsSignupCompletion).toBe(true);

    await agent.post('/auth/complete-signup').send({ name: 'Walker', ageConfirmed: true }).expect(400);
    await agent.post('/auth/complete-signup')
      .send({ name: 'Walker', ageConfirmed: true, termsAccepted: true, newsletter: true }).expect(200);
    const me = (await agent.get('/auth/user')).body;
    expect(me.needsSignupCompletion).toBe(false);
    expect(addSubscriber).toHaveBeenCalledWith('walker@example.com', pool);
  });

  it('deletes accounts left unconfirmed for 30 days and keeps the rest', async () => {
    await request(makeApp()).post('/auth/signup').send(signupBody({ email: 'old@example.com', username: 'old' })).expect(201);
    await request(makeApp()).post('/auth/signup').send(signupBody({ email: 'new@example.com', username: 'newer' })).expect(201);
    await pool.query(`UPDATE users SET created_at = NOW() - INTERVAL '31 days' WHERE email = 'old@example.com'`);

    expect(await deleteStaleUnconfirmedAccounts(pool)).toBe(1);
    const left = await pool.query('SELECT email FROM users');
    expect(left.rows.map((r) => r.email)).toEqual(['new@example.com']);
    expect((await pool.query('SELECT 1 FROM user_passwords')).rows).toHaveLength(1);
  });

  it('removes passwords and passkeys with the account', async () => {
    await request(makeApp()).post('/auth/signup').send(signupBody()).expect(201);
    const { id } = (await pool.query('SELECT id FROM users')).rows[0];
    await pool.query(`INSERT INTO user_passkeys (user_id, credential_id, public_key) VALUES ($1, 'cred', '\\x00')`, [id]);

    await deleteUserAccount(pool, id);
    expect((await pool.query('SELECT 1 FROM user_passwords')).rows).toHaveLength(0);
    expect((await pool.query('SELECT 1 FROM user_passkeys')).rows).toHaveLength(0);
  });
});
