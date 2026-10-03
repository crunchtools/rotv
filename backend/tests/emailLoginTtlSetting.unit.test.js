import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminRouter } from '../routes/admin.js';

function adminApp(pool) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 7, email: 'admin@example.com', is_admin: true, role: 'admin' };
    next();
  });
  app.use('/api/admin', createAdminRouter(pool, () => {}));
  return app;
}

describe('PUT /api/admin/settings/email_login_ttl_minutes', () => {
  it('accepts whole minutes from 5 to 60', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    for (const value of ['5', '30', '60']) {
      await request(adminApp(pool)).put('/api/admin/settings/email_login_ttl_minutes').send({ value }).expect(200);
    }
    expect(pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO admin_settings'))).toHaveLength(3);
  });

  it('rejects values outside the range or not whole minutes, without saving', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    for (const value of ['4', '61', '12.5', 'soon', '']) {
      const res = await request(adminApp(pool)).put('/api/admin/settings/email_login_ttl_minutes').send({ value }).expect(400);
      expect(res.body.error).toMatch(/5 to 60/);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
});
