/**
 * MCP is admin-only: every MCP tool is an admin tool, so only admins get a token
 * and only an admin's token (or MCP_ADMIN_TOKEN) opens a session.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { resolveUser } = await import('../services/mcpServer.js');
const { createUserSettingsRouter } = await import('../routes/userSettings.js');

const savedEnvToken = process.env.MCP_ADMIN_TOKEN;
afterEach(() => {
  if (savedEnvToken === undefined) delete process.env.MCP_ADMIN_TOKEN;
  else process.env.MCP_ADMIN_TOKEN = savedEnvToken;
});

describe('resolveUser', () => {
  it('accepts an admin user token and rejects anyone else', async () => {
    delete process.env.MCP_ADMIN_TOKEN;
    const pool = { query: vi.fn(async (sql, [token]) => ({ rows: token === 'admin-token' ? [{ id: 7 }] : [] })) };
    expect(await resolveUser(pool, 'admin-token')).toBe(7);
    expect(await resolveUser(pool, 'user-token')).toBeNull();
    expect(pool.query.mock.calls[0][0]).toMatch(/mcp_token = \$1 AND is_admin = TRUE/);
  });

  it('still accepts MCP_ADMIN_TOKEN as the first admin', async () => {
    process.env.MCP_ADMIN_TOKEN = 'env-admin-token';
    const pool = { query: vi.fn(async (sql) => ({ rows: sql.includes('mcp_token') ? [] : [{ id: 1 }] })) };
    expect(await resolveUser(pool, 'env-admin-token')).toBe(1);
    expect(await resolveUser(pool, 'env-admin-tokeX')).toBeNull();
  });
});

describe('MCP token endpoints', () => {
  function appAs(user) {
    const pool = { query: vi.fn(async () => ({ rows: [{ mcp_token: 'existing' }] })) };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.isAuthenticated = () => Boolean(user);
      req.user = user;
      next();
    });
    app.use('/api/user/settings', createUserSettingsRouter(pool));
    return { app, pool };
  }

  it('refuse non-admins without touching tokens', async () => {
    const { app, pool } = appAs({ id: 3, is_admin: false });
    await request(app).get('/api/user/settings/mcp-token').expect(403);
    await request(app).post('/api/user/settings/mcp-token/regenerate').expect(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('give an admin their token', async () => {
    const { app } = appAs({ id: 7, is_admin: true });
    const res = await request(app).get('/api/user/settings/mcp-token').expect(200);
    expect(JSON.stringify(res.body)).toContain('existing');
  });
});
