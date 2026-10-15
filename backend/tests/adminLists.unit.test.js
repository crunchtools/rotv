/**
 * /api/admin/lists (spec 052): only an admin reaches it, only a draft is changed
 * there, and publishing takes a draft with trails.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminListsRouter } from '../routes/adminLists.js';

const DRAFT = { id: 9, series: 'fall-hiking-spree', edition: 2027, status: 'draft' };

// A pool that holds one list and its items, and records every statement.
function makePool(list = DRAFT, items = [{ id: 31, poi_id: 4, position: 1 }]) {
  const log = [];
  const query = vi.fn(async (sql, params) => {
    log.push({ sql, params });
    if (sql.includes('FROM poi_lists WHERE id = $1')) return { rows: list && params[0] === list.id ? [list] : [] };
    if (sql.includes('FROM poi_list_items i JOIN pois')) return { rows: items };
    if (sql.startsWith('UPDATE poi_list_items')) return { rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  return { pool: { query }, log };
}

function appAs(user, pool) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.isAuthenticated = () => Boolean(user);
    req.user = user;
    next();
  });
  app.use('/api/admin/lists', createAdminListsRouter(pool, { mailer: { enabled: false } }));
  return app;
}

const admin = { id: 1, email: 'admin@example.com', is_admin: true };

// The test environment may let every request in as admin; these tests are about who gets in.
const bypass = process.env.BYPASS_AUTH;
beforeAll(() => { delete process.env.BYPASS_AUTH; });
afterAll(() => { if (bypass !== undefined) process.env.BYPASS_AUTH = bypass; });

describe('admin lists routes', () => {
  it('turns away anyone who is not an admin', async () => {
    const { pool } = makePool();
    expect((await request(appAs(null, pool)).get('/api/admin/lists')).status).toBe(403);
    expect((await request(appAs({ id: 2, is_admin: false }, pool)).post('/api/admin/lists/9/publish')).status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('publishes a draft with trails', async () => {
    const { pool, log } = makePool();
    const res = await request(appAs(admin, pool)).post('/api/admin/lists/9/publish');
    expect(res.status).toBe(200);
    expect(log.some(({ sql, params }) => sql.includes("SET status = 'published'") && params[0] === 9)).toBe(true);
  });

  it('will not publish an empty draft, or change a published list', async () => {
    expect((await request(appAs(admin, makePool(DRAFT, []).pool)).post('/api/admin/lists/9/publish')).status).toBe(400);
    const published = makePool({ ...DRAFT, status: 'published' });
    expect((await request(appAs(admin, published.pool)).put('/api/admin/lists/9/items/31').send({ label: 'x' })).status).toBe(409);
    expect((await request(appAs(admin, makePool().pool)).post('/api/admin/lists/77/publish')).status).toBe(404);
  });

  it('saves the fields an admin may change and refuses the rest', async () => {
    const { pool, log } = makePool();
    const app = appAs(admin, pool);
    const res = await request(app).put('/api/admin/lists/9/items/31').send({ trailhead: ' Lot A ', miles: '2.4', position: 1 });
    expect(res.status).toBe(200);
    const update = log.find(({ sql }) => sql.startsWith('UPDATE poi_list_items'));
    expect(update.sql).toContain('miles = $3');
    expect(update.sql).toContain('trailhead = $4');
    expect(update.sql).not.toContain('position');
    expect(update.params).toEqual([31, 9, 2.4, 'Lot A']);

    expect((await request(app).put('/api/admin/lists/9/items/31').send({ miles: 'far' })).status).toBe(400);
    expect((await request(app).post('/api/admin/lists/9/items').send({ label: 'No trail' })).status).toBe(400);
  });

  it('checks the year it is asked to refresh', async () => {
    const { pool } = makePool();
    expect((await request(appAs(admin, pool)).post('/api/admin/lists/refresh').send({ edition: 'next' })).status).toBe(400);
  });
});
