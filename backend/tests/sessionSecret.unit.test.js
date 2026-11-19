import { describe, it, expect } from 'vitest';
import { sessionSecret } from '../utils/authSession.js';

describe('sessionSecret (a525)', () => {
  it('uses SESSION_SECRET when it is set', () => {
    expect(sessionSecret({ SESSION_SECRET: 'configured' })).toBe('configured'); // gatehouse: allow-secret
  });

  it.each([[{}], [{ SESSION_SECRET: '' }]])('makes a fresh random key when unset (%o)', (env) => {
    const first = sessionSecret(env);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionSecret(env)).not.toBe(first);
  });
});
