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
import { releaseNewsletterOptIn } from '../services/signupNewsletter.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';

vi.mock('../services/buttondownClient.js', () => ({ addSubscriber: vi.fn(async () => ({ status: 'subscribed' })) }));

const ORIGIN = new URL(process.env.FRONTEND_URL || 'http://localhost:8080');
const STRONG = 'correct horse battery staple';

const adminPool = new pg.Pool();
const pool = new pg.Pool({ options: '-c search_path=signup_probe,public' });
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
  return message.text.match(/#token=([A-Za-z0-9_-]+)/)[1];
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
    expect(mailer.sent[0].subject).toBe('Confirm your email for Roots of the Valley');
    expect(mailer.sent[0].text).toContain('expires in 7 days');
    expect(mailer.sent[0].text).not.toMatch(/\b\d{6}\b/);

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
    // Confirming never signs in, so whoever opens the link (even a mail scanner) gets no session.
    const opener = request.agent(makeApp());
    await opener.post('/auth/email/verify').send({ token }).expect(200);
    expect((await opener.get('/auth/user')).body).toBeNull();
    // Opened again: still "confirmed", and the newsletter is released only once.
    await request(makeApp()).post('/auth/email/verify').send({ token }).expect(200);
    expect(addSubscriber).toHaveBeenCalledTimes(1);

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

  it('leaves no account behind when storing the password fails', async () => {
    // Any password row is rejected, so the insert after the account row fails.
    await pool.query('ALTER TABLE user_passwords ADD CONSTRAINT refuse_all CHECK (false) NOT VALID');
    try {
      await request(makeApp()).post('/auth/signup').send(signupBody()).expect(500);
      expect((await pool.query('SELECT 1 FROM users')).rows).toHaveLength(0);
    } finally {
      await pool.query('ALTER TABLE user_passwords DROP CONSTRAINT refuse_all');
    }
    // The connection went back to the pool and a retry succeeds.
    await request(makeApp()).post('/auth/signup').send(signupBody()).expect(201);
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

describe('passkey rejections and management', () => {
  async function signedUpWithPasskey() {
    const authenticator = createSoftAuthenticator();
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody({ method: 'passkey', password: undefined })).expect(201);
    const options = (await agent.post('/auth/passkey/register/options')).body;
    const { passkey } = (await agent.post('/auth/passkey/register/verify')
      .send({ response: authenticator.register(options, ORIGIN.origin), name: 'Laptop' }).expect(201)).body;
    return { authenticator, agent, passkey };
  }

  it('stores nothing for a registration from the wrong origin or without a challenge', async () => {
    const authenticator = createSoftAuthenticator();
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody({ method: 'passkey', password: undefined })).expect(201);

    const options = (await agent.post('/auth/passkey/register/options')).body;
    await agent.post('/auth/passkey/register/verify')
      .send({ response: authenticator.register(options, 'https://evil.example') }).expect(400);
    // The challenge was used up by the failed attempt.
    await agent.post('/auth/passkey/register/verify')
      .send({ response: authenticator.register(options, ORIGIN.origin) }).expect(400);
    expect((await pool.query('SELECT 1 FROM user_passkeys')).rows).toHaveLength(0);
  });

  it("doesn't sign in from the wrong origin or with a used challenge", async () => {
    const { authenticator } = await signedUpWithPasskey();
    const fresh = request.agent(makeApp());
    const options = (await fresh.post('/auth/passkey/login/options')).body;
    await fresh.post('/auth/passkey/login/verify')
      .send({ response: authenticator.authenticate(options, 'https://evil.example', ORIGIN.hostname) }).expect(401);
    await fresh.post('/auth/passkey/login/verify')
      .send({ response: authenticator.authenticate(options, ORIGIN.origin, ORIGIN.hostname) }).expect(401);
    expect((await fresh.get('/auth/user')).body).toBeNull();
  });

  it('renames and removes only the owner\'s passkeys', async () => {
    const { agent, passkey } = await signedUpWithPasskey();
    await agent.patch(`/auth/passkeys/${passkey.id}`).send({ name: 'Work laptop' }).expect(200);
    expect((await agent.get('/auth/methods')).body.passkeys[0].name).toBe('Work laptop');

    const stranger = request.agent(makeApp());
    await stranger.post('/auth/signup').send(signupBody({ email: 's@example.com', username: 'stranger' })).expect(201);
    await stranger.patch(`/auth/passkeys/${passkey.id}`).send({ name: 'mine now' }).expect(404);
    await stranger.delete(`/auth/passkeys/${passkey.id}`).expect(404);
    await agent.delete('/auth/passkeys/999999').expect(404);

    await agent.delete(`/auth/passkeys/${passkey.id}`).expect(200);
    expect((await agent.get('/auth/methods')).body.passkeys).toEqual([]);
  });
});

describe('changing sign-in methods', () => {
  it('removes the password', async () => {
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody()).expect(201);
    await agent.delete('/auth/password').expect(200);
    expect((await agent.get('/auth/methods')).body.hasPassword).toBe(false);
    await request(makeApp()).post('/auth/password/login').send({ email: 'jane@example.com', password: STRONG }).expect(401);
  });

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

  it('never gives an admin account a password, even one set before promotion', async () => {
    const app = makeApp();
    const agent = request.agent(app);
    await agent.post('/auth/signup').send(signupBody({ email: 'boss@example.com' })).expect(201);
    await pool.query(`UPDATE users SET is_admin = TRUE, role = 'admin' WHERE email = 'boss@example.com'`);

    const res = await agent.put('/auth/password').send({ password: 'another long passphrase' }).expect(403);
    expect(res.body.error).toMatch(/Admin accounts/);
    await request(app).post('/auth/password/login').send({ email: 'boss@example.com', password: STRONG }).expect(401);
    // Nor does "Forgot password?" email an admin.
    await request(app).post('/auth/password/forgot').send({ email: 'boss@example.com' }).expect(200);
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect(mailer.sent.filter((m) => m.subject.includes('Reset'))).toHaveLength(0);
  });
});

describe('profile, resend and challenge expiry', () => {
  it('updates the profile, keeping your own username and refusing someone else\'s', async () => {
    await request(makeApp()).post('/auth/signup').send(signupBody({ email: 'other@example.com', username: 'taken' })).expect(201);
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody()).expect(201);

    await agent.put('/auth/profile').send({ name: 'Jane Q', username: 'trailjane', displayPreference: 'name' }).expect(200);
    expect((await agent.get('/auth/user')).body).toMatchObject({ name: 'Jane Q', displayName: 'Jane Q' });
    await agent.put('/auth/profile').send({ name: 'Jane Q', username: 'TAKEN', displayPreference: 'name' }).expect(409);
    await agent.put('/auth/profile').send({ name: '', username: 'trailjane' }).expect(400);
    expect((await agent.get('/auth/user')).body.username).toBe('trailjane');
  });

  it('resends confirmation until confirmed, three times an hour', async () => {
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody()).expect(201);
    await agent.post('/auth/confirm-email/resend').expect(200);
    await agent.post('/auth/confirm-email/resend').expect(200);
    await agent.post('/auth/confirm-email/resend').expect(200);
    await agent.post('/auth/confirm-email/resend').expect(429);
    expect(mailer.sent).toHaveLength(4);

    const confirmed = request.agent(makeApp());
    await confirmed.post('/auth/signup').send(signupBody({ email: 'c@example.com', username: 'cee' })).expect(201);
    await pool.query(`UPDATE users SET email_verified_at = NOW() WHERE email = 'c@example.com'`);
    await confirmed.post('/auth/confirm-email/resend').expect(400);
  });

  it('rejects a passkey response after the challenge expires', async () => {
    const authenticator = createSoftAuthenticator();
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody({ method: 'passkey', password: undefined })).expect(201);
    const options = (await agent.post('/auth/passkey/register/options')).body;
    // Six minutes later the sign-in is still fresh (15) but the challenge (5) is not.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);
    await agent.post('/auth/passkey/register/verify').send({ response: authenticator.register(options, ORIGIN.origin) }).expect(400);
    vi.restoreAllMocks();
    expect((await pool.query('SELECT 1 FROM user_passkeys')).rows).toHaveLength(0);
  });
});

describe('migration 093 on an existing database', () => {
  it('confirms accounts that existed before it, once, and never later ones', async () => {
    await adminPool.query('DROP SCHEMA IF EXISTS signup_mig_probe CASCADE');
    await adminPool.query('CREATE SCHEMA signup_mig_probe');
    const migPool = new pg.Pool({ options: '-c search_path=signup_mig_probe,public' });
    try {
      await migPool.query(`
        CREATE TABLE users (id serial PRIMARY KEY, email varchar(255) UNIQUE, name varchar(255),
          oauth_provider varchar(50) NOT NULL, oauth_provider_id varchar(255) NOT NULL,
          is_admin boolean DEFAULT false, created_at timestamp DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE admin_settings (key text PRIMARY KEY, value text);
        INSERT INTO users (email, oauth_provider, oauth_provider_id) VALUES ('early@example.com', 'google', 'g1');
      `);
      for (const sql of migrations) await migPool.query(sql);
      await migPool.query(`INSERT INTO users (email, oauth_provider, oauth_provider_id) VALUES ('later@example.com', 'password', 'later@example.com')`);
      for (const sql of migrations) await migPool.query(sql);

      const rows = (await migPool.query('SELECT email, email_verified_at, signup_completed_at FROM users ORDER BY id')).rows;
      expect(rows[0].email_verified_at).not.toBeNull();
      expect(rows[0].signup_completed_at).not.toBeNull();
      expect(rows[1].email_verified_at).toBeNull();
      expect(rows[1].signup_completed_at).toBeNull();
    } finally {
      await migPool.end();
      await adminPool.query('DROP SCHEMA IF EXISTS signup_mig_probe CASCADE');
    }
  });
});

describe('confirmation and the newsletter', () => {
  it('keeps the opt-in for a later retry when Buttondown fails', async () => {
    await request(makeApp()).post('/auth/signup').send(signupBody()).expect(201);
    await pool.query('UPDATE users SET email_verified_at = NOW()');
    const user = (await pool.query('SELECT * FROM users')).rows[0];
    vi.mocked(addSubscriber).mockRejectedValueOnce(new Error('Buttondown 503'));

    expect(await releaseNewsletterOptIn(pool, user)).toBe(false);
    expect((await pool.query('SELECT newsletter_opt_in FROM users')).rows[0].newsletter_opt_in).toBe(true);
    expect(await releaseNewsletterOptIn(pool, user)).toBe(true);
    expect((await pool.query('SELECT newsletter_opt_in FROM users')).rows[0].newsletter_opt_in).toBe(false);
  });
});

describe('account protection and cleanup', () => {
  it('refuses an already-used link while the account is still unconfirmed', async () => {
    await request(makeApp()).post('/auth/signup').send(signupBody()).expect(201);
    const token = linkToken(mailer.sent[0]);
    await pool.query('UPDATE email_login_tokens SET consumed_at = NOW()');
    await request(makeApp()).post('/auth/email/verify').send({ token }).expect(400);
    expect((await pool.query('SELECT email_verified_at FROM users')).rows[0].email_verified_at).toBeNull();
  });

  it("doesn't recreate a deleted account from its confirmation link", async () => {
    const agent = request.agent(makeApp());
    await agent.post('/auth/signup').send(signupBody()).expect(201);
    const token = linkToken(mailer.sent[0]);
    await agent.delete('/auth/account').expect(200);
    await request(makeApp()).post('/auth/email/verify').send({ token }).expect(400);
    expect((await pool.query('SELECT 1 FROM users')).rows).toHaveLength(0);
  });

  it('lets the address owner take over an unconfirmed sign-up through "Forgot password?"', async () => {
    const authenticator = createSoftAuthenticator();
    const squatter = request.agent(makeApp());
    await squatter.post('/auth/signup').send(signupBody({ email: 'owner@example.com' })).expect(201);
    const confirmToken = linkToken(mailer.sent[0]);
    const options = (await squatter.post('/auth/passkey/register/options')).body;
    await squatter.post('/auth/passkey/register/verify').send({ response: authenticator.register(options, ORIGIN.origin) }).expect(201);

    const owner = request.agent(makeApp());
    await owner.post('/auth/password/forgot').send({ email: 'owner@example.com' }).expect(200);
    await vi.waitFor(() => expect(mailer.sent.some((m) => m.subject.includes('Reset'))).toBe(true));
    const reset = mailer.sent.find((m) => m.subject.includes('Reset'));
    await owner.post('/auth/password/reset').send({ token: linkToken(reset), password: 'the real owner passphrase' }).expect(200);

    expect((await owner.get('/auth/user')).body.emailVerified).toBe(true);
    expect((await pool.query('SELECT 1 FROM user_passkeys')).rows).toHaveLength(0);
    expect((await pool.query('SELECT newsletter_opt_in FROM users')).rows[0].newsletter_opt_in).toBe(false);
    // The squatter's password no longer works, and their confirmation link can't sign anyone in.
    await request(makeApp()).post('/auth/password/login').send({ email: 'owner@example.com', password: STRONG }).expect(401);
    const stale = request.agent(makeApp());
    await stale.post('/auth/email/verify').send({ token: confirmToken }).expect(200);
    expect((await stale.get('/auth/user')).body).toBeNull();
    await request(makeApp()).post('/auth/password/login')
      .send({ email: 'owner@example.com', password: 'the real owner passphrase' }).expect(200);
  });

  it('removes every passkey when the owner later resets the password', async () => {
    const authenticator = createSoftAuthenticator();
    const squatter = request.agent(makeApp());
    await squatter.post('/auth/signup').send(signupBody({ email: 'owner@example.com', method: 'passkey', password: undefined })).expect(201);
    const confirmToken = linkToken(mailer.sent[0]);
    const options = (await squatter.post('/auth/passkey/register/options')).body;
    await squatter.post('/auth/passkey/register/verify').send({ response: authenticator.register(options, ORIGIN.origin) }).expect(201);

    // The owner confirms first (the account stays), then recovers it.
    await request(makeApp()).post('/auth/email/verify').send({ token: confirmToken }).expect(200);
    const owner = request.agent(makeApp());
    await owner.post('/auth/password/forgot').send({ email: 'owner@example.com' }).expect(200);
    await vi.waitFor(() => expect(mailer.sent.some((m) => m.subject.includes('Reset'))).toBe(true));
    const reset = mailer.sent.find((m) => m.subject.includes('Reset'));
    await owner.post('/auth/password/reset').send({ token: linkToken(reset), password: 'the real owner passphrase' }).expect(200);

    expect((await pool.query('SELECT 1 FROM user_passkeys')).rows).toHaveLength(0);
    const fresh = request.agent(makeApp());
    const loginOptions = (await fresh.post('/auth/passkey/login/options')).body;
    await fresh.post('/auth/passkey/login/verify')
      .send({ response: authenticator.authenticate(loginOptions, ORIGIN.origin, ORIGIN.hostname) }).expect(401);
  });

  it('removes passkeys added after confirmation too: recovery starts clean', async () => {
    const authenticator = createSoftAuthenticator();
    const agent = request.agent(makeApp());
    // This app's outbox; makeApp() below swaps the global one.
    const outbox = mailer;
    await agent.post('/auth/signup').send(signupBody()).expect(201);
    const confirmToken = linkToken(outbox.sent[0]);
    await request(makeApp()).post('/auth/email/verify').send({ token: confirmToken }).expect(200);
    const options = (await agent.post('/auth/passkey/register/options')).body;
    await agent.post('/auth/passkey/register/verify').send({ response: authenticator.register(options, ORIGIN.origin) }).expect(201);

    await agent.post('/auth/password/forgot').send({ email: 'jane@example.com' }).expect(200);
    await vi.waitFor(() => expect(outbox.sent.some((m) => m.subject.includes('Reset'))).toBe(true));
    await agent.post('/auth/password/reset')
      .send({ token: linkToken(outbox.sent.find((m) => m.subject.includes('Reset'))), password: 'another long passphrase' }).expect(200);
    expect((await pool.query('SELECT 1 FROM user_passkeys')).rows).toHaveLength(0);
  });

  it('sends accounts made outside the form to finish sign-up', async () => {
    await findOrCreateUser(pool, 'nobody@example.com', 'google', { id: 'g-walker', displayName: 'Walker', emails: [{ value: 'walker@example.com' }] }, null);
    const agent = request.agent(makeApp());
    await agent.post('/auth/password/forgot').send({ email: 'walker@example.com' }).expect(200);
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    const reset = await agent.post('/auth/password/reset')
      .send({ token: linkToken(mailer.sent[0]), password: 'walker long passphrase' }).expect(200);
    expect(reset.body.needsSignupCompletion).toBe(true);

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
    // An account confirmed after being selected is kept.
    await pool.query(`UPDATE users SET created_at = NOW() - INTERVAL '31 days', email_verified_at = NOW() WHERE email = 'new@example.com'`);
    const { id: confirmedId } = (await pool.query(`SELECT id FROM users WHERE email = 'new@example.com'`)).rows[0];
    expect(await deleteUserAccount(pool, confirmedId, { unconfirmedForDays: 30 })).toBe(false);
    await pool.query(`UPDATE users SET created_at = NOW(), email_verified_at = NULL WHERE email = 'new@example.com'`);
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
