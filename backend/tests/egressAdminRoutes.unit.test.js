/**
 * Network Routes admin API (/api/admin/egress): admin-only, validation → 400,
 * unexpected failures → 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/egressAdmin.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getEgressOverview: vi.fn(async () => ({ defaultRoute: 'expressvpn', routes: [] })),
    setDomainRoute: vi.fn(async (pool, domain, route) => ({ domain, route })),
    setEgressSettings: vi.fn(async () => {})
  };
});

const egress = await import('../services/egressAdmin.js');
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

const admin = appAs({ id: 7, email: 'a@example.org', is_admin: true });

beforeEach(() => vi.clearAllMocks());

describe('network routes API', () => {
  it('requires an admin', async () => {
    await request(appAs(null)).get('/api/admin/egress').expect(403);
    await request(appAs({ id: 3, is_admin: false })).put('/api/admin/egress/routes/cvsr.org').send({ route: 'direct' }).expect(403);
    expect(egress.setDomainRoute).not.toHaveBeenCalled();
  });

  it('reads the overview and pins, resets and configures routes', async () => {
    expect((await request(admin).get('/api/admin/egress').expect(200)).body.defaultRoute).toBe('expressvpn');

    await request(admin).put('/api/admin/egress/routes/cvsr.org').send({ route: 'residential' }).expect(200);
    expect(egress.setDomainRoute).toHaveBeenLastCalledWith(pool, 'cvsr.org', 'residential', 7);

    await request(admin).delete('/api/admin/egress/routes/cvsr.org').expect(200);
    expect(egress.setDomainRoute).toHaveBeenLastCalledWith(pool, 'cvsr.org', 'default', 7);

    await request(admin).put('/api/admin/egress/settings').send({ defaultRoute: 'direct', residentialCap: 50 }).expect(200);
    expect(egress.setEgressSettings).toHaveBeenCalledWith(pool, { defaultRoute: 'direct', residentialCap: 50 }, 7);
  });

  it('answers bad input with 400 and other failures with 500', async () => {
    egress.setDomainRoute.mockRejectedValueOnce(new egress.EgressValidationError('Not a domain: x'));
    const bad = await request(admin).put('/api/admin/egress/routes/x').send({ route: 'direct' }).expect(400);
    expect(bad.body.error).toBe('Not a domain: x');

    egress.getEgressOverview.mockRejectedValueOnce(new Error('db down'));
    await request(admin).get('/api/admin/egress').expect(500);
  });
});
