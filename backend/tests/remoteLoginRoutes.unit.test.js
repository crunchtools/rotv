import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/remoteLoginSession.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startLogin: vi.fn(async () => {}),
    getFrame: vi.fn(async () => ({ image: Buffer.from('jpeg-bytes'), url: 'https://www.facebook.com/login/', loggedIn: true })),
    sendInput: vi.fn(async () => {}),
    saveLogin: vi.fn(async () => ({ cookiesCount: 2, expires: '2026-12-01T00:00:00.000Z' })),
    cancelLogin: vi.fn(async () => {})
  };
});

const session = await import('../services/remoteLoginSession.js');
const { createAdminRouter } = await import('../routes/admin.js');

const pool = { query: vi.fn() };

function appAs(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.isAuthenticated = () => Boolean(user);
    req.user = user;
    next();
  });
  app.use('/api/admin', createAdminRouter(pool, () => {}));
  return app;
}

const admin = appAs({ id: 7, is_admin: true });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('remote-login routes', () => {
  it('require an admin', async () => {
    await request(appAs(null)).post('/api/admin/remote-login/facebook/start').expect(403);
    await request(appAs({ id: 3, is_admin: false })).get('/api/admin/remote-login/facebook/frame').expect(403);
    expect(session.startLogin).not.toHaveBeenCalled();
  });

  it('start passes the provider and admin id and returns the viewport', async () => {
    const res = await request(admin).post('/api/admin/remote-login/facebook/start').expect(200);
    expect(session.startLogin).toHaveBeenCalledWith('facebook', 7);
    expect(res.body).toEqual({ success: true, viewport: session.VIEWPORT });
  });

  it('frame returns a no-store JPEG with login state headers', async () => {
    const res = await request(admin).get('/api/admin/remote-login/facebook/frame').expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-logged-in']).toBe('true');
    expect(res.body.toString()).toBe('jpeg-bytes');
  });

  it('input forwards the event body', async () => {
    await request(admin).post('/api/admin/remote-login/facebook/input').send({ type: 'click', x: 1, y: 2 }).expect(200);
    expect(session.sendInput).toHaveBeenCalledWith('facebook', 7, { type: 'click', x: 1, y: 2 });
  });

  it('save returns the stored session summary', async () => {
    const res = await request(admin).post('/api/admin/remote-login/facebook/save').expect(200);
    expect(session.saveLogin).toHaveBeenCalledWith(pool, 'facebook', 7);
    expect(res.body).toEqual({ success: true, cookiesCount: 2, expires: '2026-12-01T00:00:00.000Z' });
  });

  it('maps session errors to their HTTP status', async () => {
    session.sendInput.mockRejectedValueOnce(new session.LoginSessionError('Key not allowed: F12'));
    session.getFrame.mockRejectedValueOnce(new session.LoginSessionError('No login session is running for this provider', 404));
    const bad = await request(admin).post('/api/admin/remote-login/facebook/input').send({ type: 'key', key: 'F12' }).expect(400);
    expect(bad.body).toEqual({ success: false, error: 'Key not allowed: F12' });
    await request(admin).get('/api/admin/remote-login/facebook/frame').expect(404);
    await request(admin).get('/api/admin/remote-login/myspace/status').expect(404);
  });

  it('status reports connection, expiry and staleness', async () => {
    const xsExpiry = Math.floor(Date.parse('2027-01-01T00:00:00Z') / 1000);
    pool.query.mockResolvedValueOnce({
      rows: [
        { key: 'facebook_cookies', value: JSON.stringify([{ name: 'xs', expires: xsExpiry }]), updated_at: '2026-09-26' },
        { key: 'facebook_consecutive_failures', value: '4' }
      ]
    });
    const res = await request(admin).get('/api/admin/remote-login/facebook/status').expect(200);
    expect(res.body).toMatchObject({
      connected: true, expires: '2027-01-01T00:00:00.000Z', is_expired: false,
      consecutive_failures: 4, possibly_stale: true
    });
  });

  it('status reports not connected when no session is saved', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(admin).get('/api/admin/remote-login/facebook/status').expect(200);
    expect(res.body).toEqual({ connected: false, consecutive_failures: 0 });
  });

  it('delete removes the session and its failure counter', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 2 });
    await request(admin).delete('/api/admin/remote-login/facebook/session').expect(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM admin_settings/), ['facebook_cookies', 'facebook_consecutive_failures']);
  });
});
