import { describe, it, expect, afterEach, vi } from 'vitest';
import { isAuthenticated, isAdmin, optionalAuth } from '../middleware/auth.js';

function mockReq({ user = null, authenticated = false } = {}) {
  return { user, isAuthenticated: () => authenticated };
}

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn(code => { res.statusCode = code; return res; });
  res.json = vi.fn(body => { res.body = body; return res; });
  return res;
}

function run(middleware, req) {
  const res = mockRes();
  const next = vi.fn();
  middleware(req, res, next);
  return { res, next };
}

// The suite runs with NODE_ENV=test; BYPASS_AUTH decides whether the bypass is live.
afterEach(() => vi.unstubAllEnvs());

describe('auth middleware without the test bypass', () => {
  it('isAuthenticated rejects anonymous requests with 401', () => {
    vi.stubEnv('BYPASS_AUTH', 'false');
    const { res, next } = run(isAuthenticated, mockReq());
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('isAuthenticated admits a signed-in user', () => {
    vi.stubEnv('BYPASS_AUTH', 'false');
    const { next } = run(isAuthenticated, mockReq({ user: { id: 1 }, authenticated: true }));
    expect(next).toHaveBeenCalledOnce();
  });

  it('isAdmin rejects a signed-in non-admin with 403', () => {
    vi.stubEnv('BYPASS_AUTH', 'false');
    const { res, next } = run(isAdmin, mockReq({ user: { id: 1, is_admin: false }, authenticated: true }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('isAdmin rejects an anonymous request with 403', () => {
    vi.stubEnv('BYPASS_AUTH', 'false');
    const { res, next } = run(isAdmin, mockReq({ user: { is_admin: true }, authenticated: false }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('isAdmin admits a signed-in admin', () => {
    vi.stubEnv('BYPASS_AUTH', 'false');
    const { next } = run(isAdmin, mockReq({ user: { id: 1, is_admin: true }, authenticated: true }));
    expect(next).toHaveBeenCalledOnce();
  });

  it('optionalAuth never blocks and leaves the anonymous user unset', () => {
    vi.stubEnv('BYPASS_AUTH', 'false');
    const req = mockReq();
    const { next } = run(optionalAuth, req);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toBeNull();
  });
});

describe('auth middleware with the test bypass', () => {
  it('injects the test admin for isAdmin', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('BYPASS_AUTH', 'true');
    const req = mockReq();
    const { next } = run(isAdmin, req);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 999, is_admin: true, role: 'admin' });
  });

  it('never bypasses outside NODE_ENV=test', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BYPASS_AUTH', 'true');
    const { res, next } = run(isAdmin, mockReq());
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
