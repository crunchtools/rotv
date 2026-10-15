/**
 * /api/admin/trail-shapes/sync (#778): only an admin runs it, a dry run is
 * passed through, and a failure to reach the district is a 502.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTrailShapesRouter } from '../routes/adminTrailShapes.js';

function appAs(user, sync) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.isAuthenticated = () => Boolean(user);
    req.user = user;
    next();
  });
  app.use('/api/admin/trail-shapes', createTrailShapesRouter({}, { sync }));
  return app;
}

const admin = { id: 1, email: 'admin@example.com', is_admin: true };

// The test environment may let every request in as admin; these tests are about who gets in.
const bypass = process.env.BYPASS_AUTH;
beforeAll(() => { delete process.env.BYPASS_AUTH; });
afterAll(() => { if (bypass !== undefined) process.env.BYPASS_AUTH = bypass; });

describe('trail shape sync route', () => {
  it('runs for an admin, passing a dry run through, and answers with the result', async () => {
    const sync = vi.fn().mockResolvedValue({ updated: [{ id: 7 }], missing: [] });
    const res = await request(appAs(admin, sync)).post('/api/admin/trail-shapes/sync').send({ dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual([{ id: 7 }]);
    expect(sync).toHaveBeenCalledWith({}, { dryRun: true });
  });

  it('writes unless dryRun is exactly true', async () => {
    const sync = vi.fn().mockResolvedValue({ updated: [], missing: [] });
    await request(appAs(admin, sync)).post('/api/admin/trail-shapes/sync').send({ dryRun: 'yes' });
    expect(sync).toHaveBeenCalledWith({}, { dryRun: false });
  });

  it('answers 502 when the district cannot be read', async () => {
    const sync = vi.fn().mockRejectedValue(new Error('SMP Trails by Name answered HTTP 503'));
    const res = await request(appAs(admin, sync)).post('/api/admin/trail-shapes/sync');
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('503');
  });

  it('turns away anyone who is not an admin', async () => {
    const sync = vi.fn();
    expect((await request(appAs({ id: 2, is_admin: false }, sync)).post('/api/admin/trail-shapes/sync')).status).toBe(403);
    expect((await request(appAs(null, sync)).post('/api/admin/trail-shapes/sync')).status).toBe(403);
    expect(sync).not.toHaveBeenCalled();
  });
});
