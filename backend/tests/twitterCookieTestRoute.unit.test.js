import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let finalUrl = 'https://x.com/home';
const pageStub = {
  goto: vi.fn(async () => {}),
  waitForTimeout: vi.fn(async () => {}),
  url: vi.fn(() => finalUrl),
  title: vi.fn(async () => 'Home / X')
};
const contextStub = {
  addCookies: vi.fn(async () => {}),
  newPage: vi.fn(async () => pageStub),
  close: vi.fn(async () => {})
};
const browserStub = { newContext: vi.fn(async () => contextStub), version: () => '145.0.7632.6' };

vi.mock('../services/browserPool.js', async (importOriginal) => ({
  ...(await importOriginal()),
  acquireBrowser: vi.fn(async () => ({ browser: browserStub, acquisitionId: 42 })),
  releaseBrowser: vi.fn()
}));

const browserPool = await import('../services/browserPool.js');
const { createAdminRouter } = await import('../routes/admin.js');

const SAVED = [
  { name: 'auth_token', value: 't', domain: '.x.com', path: '/', sameSite: 'no_restriction' },
  { name: 'kdt', value: 'k', domain: '.x.com', path: '/', sameSite: null },
  { name: 'ct0', value: 'c', domain: '.x.com', path: '/', sameSite: 'lax' }
];
const pool = { query: vi.fn(async () => ({ rows: [{ value: JSON.stringify(SAVED) }] })) };

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.isAuthenticated = () => true;
  req.user = { id: 7, is_admin: true };
  next();
});
app.use('/api/admin', createAdminRouter(pool, () => {}));

beforeEach(() => {
  vi.clearAllMocks();
  finalUrl = 'https://x.com/home';
});

describe('POST /twitter/test-cookies', () => {
  it('uses the proxied pool with a version-matched UA, then closes and releases', async () => {
    const res = await request(app).post('/api/admin/twitter/test-cookies').expect(200);
    expect(res.body.logged_in).toBe(true);
    expect(browserPool.acquireBrowser).toHaveBeenCalledTimes(1);
    expect(browserStub.newContext).toHaveBeenCalledWith({ userAgent: expect.stringContaining('Chrome/145.0.0.0') });
    expect(contextStub.addCookies.mock.calls[0][0].map(c => c.sameSite)).toEqual(['None', 'None', 'Lax']);
    expect(contextStub.close).toHaveBeenCalledTimes(1);
    expect(browserPool.releaseBrowser).toHaveBeenCalledWith(42);
  });

  it('reports expired cookies when X redirects to login', async () => {
    finalUrl = 'https://x.com/i/flow/login';
    const res = await request(app).post('/api/admin/twitter/test-cookies').expect(200);
    expect(res.body.logged_in).toBe(false);
    expect(browserPool.releaseBrowser).toHaveBeenCalledWith(42);
  });

  it('still closes and releases when navigation fails', async () => {
    pageStub.goto.mockRejectedValueOnce(new Error('net::ERR_TIMED_OUT'));
    await request(app).post('/api/admin/twitter/test-cookies').expect(500);
    expect(contextStub.close).toHaveBeenCalledTimes(1);
    expect(browserPool.releaseBrowser).toHaveBeenCalledWith(42);
  });

  it('releases without a context when context creation fails', async () => {
    browserStub.newContext.mockRejectedValueOnce(new Error('browser gone'));
    await request(app).post('/api/admin/twitter/test-cookies').expect(500);
    expect(contextStub.close).not.toHaveBeenCalled();
    expect(browserPool.releaseBrowser).toHaveBeenCalledWith(42);
  });

  it('acquires nothing when no cookies are saved', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).post('/api/admin/twitter/test-cookies').expect(404);
    expect(browserPool.acquireBrowser).not.toHaveBeenCalled();
    expect(browserPool.releaseBrowser).not.toHaveBeenCalled();
  });
});
