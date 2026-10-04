import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { deleteUserAccount } from '../services/accountDeletion.js';
import { renderLegalMarkdown } from '../utils/legalMarkdown.js';
import { createAuthRouter } from '../routes/auth.js';

/**
 * Fake pool whose client records every statement. `failOn` makes any
 * statement containing that text throw.
 */
function makePool({ user = { id: 5, email: 'Hiker@Example.com' }, failOn = null } = {}) {
  const log = [];
  const client = {
    query: vi.fn(async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      log.push({ sql: s, params });
      if (failOn && s.includes(failOn)) throw new Error(`boom: ${failOn}`);
      if (s.startsWith('SELECT id, email FROM users')) return { rows: user ? [user] : [] };
      return { rows: [] };
    }),
    release: vi.fn()
  };
  return { pool: { connect: async () => client }, client, log };
}

describe('deleteUserAccount', () => {
  it('clears sessions and newsletter rows, then deletes the user in one transaction', async () => {
    const { pool, client, log } = makePool();

    expect(await deleteUserAccount(pool, 5)).toBe(true);

    const sqls = log.map((l) => l.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(log.find((l) => l.sql.startsWith('DELETE FROM newsletter_subscriptions')).params).toEqual(['Hiker@Example.com']);
    expect(log.find((l) => l.sql.startsWith('DELETE FROM sessions')).params).toEqual(['5']);
    expect(sqls.indexOf('DELETE FROM users WHERE id = $1')).toBe(sqls.length - 2);
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('returns false and changes nothing for an unknown user', async () => {
    const { pool, log } = makePool({ user: null });
    expect(await deleteUserAccount(pool, 404)).toBe(false);
    expect(log.map((l) => l.sql)).toEqual([
      'BEGIN',
      'SELECT id, email FROM users WHERE id = $1 FOR UPDATE',
      'ROLLBACK'
    ]);
  });

  it('rolls back and rethrows when any step fails', async () => {
    const { pool, client, log } = makePool({ failOn: 'DELETE FROM users' });
    await expect(deleteUserAccount(pool, 5)).rejects.toThrow('boom');
    const sqls = log.map((l) => l.sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('auth routes for #700', () => {
  const savedEnv = { ...process.env };

  function appAs(user, pool = { query: vi.fn() }) {
    const app = express();
    app.use((req, res, next) => {
      req.isAuthenticated = () => Boolean(user);
      req.user = user;
      req.logout = (cb) => cb();
      req.session = { destroy: (cb) => cb() };
      next();
    });
    app.use('/auth', createAuthRouter(pool));
    return app;
  }

  beforeEach(() => {
    delete process.env.BYPASS_AUTH;
    delete process.env.SMTP_HOST;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('/auth/providers reports only configured providers', async () => {
    process.env.GOOGLE_CLIENT_ID = 'g';
    process.env.GOOGLE_CLIENT_SECRET = 'gs';
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    const res = await request(appAs(null)).get('/auth/providers').expect(200);
    expect(res.body).toEqual({ google: true, facebook: false, email: false, password: true, passkey: true });

    process.env.FACEBOOK_APP_ID = 'f';
    process.env.FACEBOOK_APP_SECRET = 'fs';
    delete process.env.FACEBOOK_LOGIN_LIVE;
    const staged = await request(appAs(null)).get('/auth/providers').expect(200);
    expect(staged.body).toEqual({ google: true, facebook: false, email: false, password: true, passkey: true });

    process.env.FACEBOOK_LOGIN_LIVE = 'true';
    const live = await request(appAs(null)).get('/auth/providers').expect(200);
    expect(live.body).toEqual({ google: true, facebook: true, email: false, password: true, passkey: true });
  });

  it('DELETE /auth/account requires sign-in', async () => {
    await request(appAs(null)).delete('/auth/account').expect(401);
  });

  it('DELETE /auth/account refuses admins', async () => {
    await request(appAs({ id: 1, is_admin: true, role: 'admin' })).delete('/auth/account').expect(403);
  });

  it('DELETE /auth/account deletes a viewer and clears the cookie', async () => {
    const { pool, log } = makePool({ user: { id: 42, email: 'v@example.com' } });
    const res = await request(appAs({ id: 42, is_admin: false, role: 'viewer' }, pool))
      .delete('/auth/account')
      .expect(200);
    expect(res.body).toEqual({ success: true });
    expect(res.headers['set-cookie']?.[0]).toMatch(/^connect\.sid=;/);
    expect(log.find((l) => l.sql === 'DELETE FROM users WHERE id = $1').params).toEqual([42]);
  });

  it('DELETE /auth/account reports failure without claiming success', async () => {
    const { pool } = makePool({ user: { id: 42, email: 'v@example.com' }, failOn: 'DELETE FROM users' });
    const res = await request(appAs({ id: 42, is_admin: false, role: 'viewer' }, pool))
      .delete('/auth/account')
      .expect(500);
    expect(res.body.error).toMatch(/Nothing was deleted/);
  });
});

describe('renderLegalMarkdown', () => {
  it('renders headings, lists, links and emphasis', () => {
    const html = renderLegalMarkdown([
      '# Deleting Your Data',
      '',
      '1. Open **Settings**.',
      '2. Choose *Delete*.',
      '',
      '- Your [favorites](/data-deletion)',
      '- Contact [us](https://example.com/a?b=1&c=2)'
    ].join('\n'));
    expect(html).toBe([
      '<h1>Deleting Your Data</h1>',
      '<ol>',
      '<li>Open <strong>Settings</strong>.</li>',
      '<li>Choose <em>Delete</em>.</li>',
      '</ol>',
      '<ul>',
      '<li>Your <a href="/data-deletion">favorites</a></li>',
      '<li>Contact <a href="https://example.com/a?b=1&amp;c=2">us</a></li>',
      '</ul>'
    ].join('\n'));
  });

  it('escapes HTML and drops non-http link targets', () => {
    const html = renderLegalMarkdown('<script>x</script> [click](javascript:alert(1))');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;');
  });
});
