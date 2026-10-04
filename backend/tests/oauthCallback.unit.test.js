/**
 * Google and Facebook callbacks (spec 046): new accounts that skipped the
 * sign-up form land on /welcome, finished ones go home, and both sessions are
 * stamped as freshly signed in. passport.authenticate is stubbed to hand over
 * a user the way a completed OAuth round trip would.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import request from 'supertest';

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:8080';
const saved = {};

beforeAll(() => {
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET']) {
    saved[key] = process.env[key];
    process.env[key] = 'test';
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterEach(() => vi.restoreAllMocks());

describe('OAuth callbacks', () => {
  it.each([
    ['google', 'new account', { id: 1, email: 'new@example.com', signup_completed_at: null }, `${FRONTEND}/welcome?auth=success`],
    ['google', 'finished account', { id: 2, email: 'old@example.com', signup_completed_at: '2026-01-01' }, `${FRONTEND}?auth=success`],
    ['facebook', 'new account', { id: 3, email: 'fb@example.com', signup_completed_at: null }, `${FRONTEND}/welcome?auth=success`]
  ])('%s sends a %s to the right place and stamps the sign-in', async (provider, _label, user, location) => {
    vi.spyOn(passport, 'authenticate').mockImplementation(() => (req, res, next) => {
      req.user = user;
      next();
    });
    const { createAuthRouter } = await import('../routes/auth.js');
    const app = express();
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/auth', createAuthRouter({ query: vi.fn() }, { mailer: { enabled: false } }));
    app.get('/peek', (req, res) => res.json({ authAt: req.session.authAt ?? null }));

    const agent = request.agent(app);
    const before = Date.now();
    const res = await agent.get(`/auth/${provider}/callback`).expect(302);
    expect(res.headers.location).toBe(location);
    const { authAt } = (await agent.get('/peek')).body;
    expect(authAt).toBeGreaterThanOrEqual(before);
  });
});
