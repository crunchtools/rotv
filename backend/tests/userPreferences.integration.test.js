/**
 * The preference routes against a real database (spec 050): a signed-in change
 * replaces what the account held, and the sign-in sync only fills gaps.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { createUserSettingsRouter } from '../routes/userSettings.js';

const adminPool = new pg.Pool();
const probe = new pg.Pool({ options: '-c search_path=user_preferences_probe,public' });

const HIKER = 1;
let signedInAs = HIKER;
const bypassBefore = process.env.BYPASS_AUTH;

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.isAuthenticated = () => signedInAs !== null;
  req.user = signedInAs === null ? undefined : { id: signedInAs };
  next();
});
app.use('/api/user/settings', createUserSettingsRouter(probe));

const preferencesOf = async (userId) =>
  (await probe.query('SELECT preferences FROM users WHERE id = $1', [userId])).rows[0].preferences;

beforeAll(() => {
  // The test-mode bypass would sign every request in as the shared admin.
  process.env.BYPASS_AUTH = 'false';
});

beforeEach(async () => {
  signedInAs = HIKER;
  await adminPool.query('DROP SCHEMA IF EXISTS user_preferences_probe CASCADE');
  await adminPool.query('CREATE SCHEMA user_preferences_probe');
  await probe.query(`CREATE TABLE users (id serial PRIMARY KEY, timezone text, preferences jsonb DEFAULT '{}')`);
  await probe.query('INSERT INTO users (preferences) VALUES ($1::jsonb), ($2::jsonb)', ['{"theme":"dark"}', '{}']);
});

afterAll(async () => {
  process.env.BYPASS_AUTH = bypassBefore;
  await probe.end();
  await adminPool.query('DROP SCHEMA IF EXISTS user_preferences_probe CASCADE');
  await adminPool.end();
});

describe('PUT /api/user/settings/preferences', () => {
  it('saves a preference beside the ones the account already holds', async () => {
    const res = await request(app).put('/api/user/settings/preferences').send({ listSort: 'park' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: { theme: 'dark', listSort: 'park' } });
    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark', listSort: 'park' });
    expect(await preferencesOf(2)).toEqual({});
  });

  it('replaces the value the account held', async () => {
    await request(app).put('/api/user/settings/preferences').send({ listSort: 'park' });
    await request(app).put('/api/user/settings/preferences').send({ listSort: 'difficulty-desc' });

    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark', listSort: 'difficulty-desc' });
  });

  it('saves the trail picked for a list\'s free choice', async () => {
    const res = await request(app).put('/api/user/settings/preferences').send({ listChoices: { 1: 1044, bogus: 7 } });

    expect(res.status).toBe(200);
    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark', listChoices: { 1: 1044 } });
  });

  it('saves contact details and clears them again', async () => {
    await request(app).put('/api/user/settings/preferences')
      .send({ contact: { firstName: 'Scott', lastName: 'McCarty', address: '1 Main St', isAdmin: 'yes' } });
    expect(await preferencesOf(HIKER)).toEqual({
      theme: 'dark', contact: { firstName: 'Scott', lastName: 'McCarty', address: '1 Main St' }
    });

    await request(app).put('/api/user/settings/preferences').send({ contact: {} });
    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark', contact: {} });
  });

  it('refuses a body with no known preference and stores nothing', async () => {
    const res = await request(app).put('/api/user/settings/preferences').send({ listSort: 'sideways', isAdmin: true });

    expect(res.status).toBe(400);
    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark' });
  });

  it('requires a signed-in user', async () => {
    signedInAs = null;
    const res = await request(app).put('/api/user/settings/preferences').send({ listSort: 'park' });

    expect(res.status).toBe(401);
    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark' });
  });

  it('answers 500 when the database fails', async () => {
    const broken = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const failing = express();
    failing.use(express.json());
    failing.use((req, res, next) => { req.isAuthenticated = () => true; req.user = { id: HIKER }; next(); });
    failing.use('/api/user/settings', createUserSettingsRouter(broken));

    const res = await request(failing).put('/api/user/settings/preferences').send({ listSort: 'park' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save preferences' });
  });
});

describe('POST /api/user/settings/sync preferences', () => {
  it('fills a preference the account does not hold', async () => {
    const res = await request(app).post('/api/user/settings/sync').send({ preferences: { listSort: 'trail' } });

    expect(res.status).toBe(200);
    expect(res.body.synced.preferences).toBe(true);
    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark', listSort: 'trail' });
  });

  it('keeps the account\'s value over the device\'s', async () => {
    await request(app).put('/api/user/settings/preferences').send({ listSort: 'park' });

    await request(app).post('/api/user/settings/sync').send({ preferences: { listSort: 'trail' } });

    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark', listSort: 'park' });
  });

  it('ignores preferences it does not know', async () => {
    const res = await request(app).post('/api/user/settings/sync').send({ preferences: { listSort: 'sideways', role: 'admin' } });

    expect(res.status).toBe(200);
    expect(res.body.synced.preferences).toBe(false);
    expect(await preferencesOf(HIKER)).toEqual({ theme: 'dark' });
  });
});
