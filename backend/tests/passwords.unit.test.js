import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { hashPassword, verifyPassword, breachCount, passwordProblem } from '../services/passwords.js';
import { parseProfile, usernameProblem, displayNameOf } from '../services/accountProfile.js';

const okFetch = (body) => vi.fn(async () => ({ ok: true, text: async () => body }));

describe('password hashing', () => {
  it('round-trips, salts every hash, and rejects the wrong password', async () => {
    const first = await hashPassword('a long enough passphrase');
    const second = await hashPassword('a long enough passphrase');
    expect(first).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword('a long enough passphrase', first)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword('a long enough passphrasE', first)).ok).toBe(false);
  });

  it('never matches when the account has no password', async () => {
    expect(await verifyPassword('anything at all here', null)).toEqual({ ok: false, needsRehash: false });
  });

  it('flags hashes made with weaker parameters for an upgrade', async () => {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync('old password value', salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    const legacy = ['scrypt', 2 ** 14, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
    expect(await verifyPassword('old password value', legacy)).toEqual({ ok: true, needsRehash: true });
  });
});

describe('breached-password check', () => {
  it('sends only the 5-character prefix and finds the suffix in the reply', async () => {
    const sha1 = crypto.createHash('sha1').update('password1234').digest('hex').toUpperCase();
    const fetchImpl = okFetch(`00000000000000000000000000000000001:3\r\n${sha1.slice(5)}:9001`);
    expect(await breachCount('password1234', fetchImpl)).toBe(9001);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
  });

  it('fails open when the service is unreachable', async () => {
    const down = vi.fn(async () => { throw new Error('ENOTFOUND'); });
    expect(await breachCount('anything', down)).toBeNull();
    expect(await passwordProblem('a perfectly fine passphrase', down)).toBeNull();
  });

  it('enforces length limits before calling the service', async () => {
    const fetchImpl = okFetch('');
    expect(await passwordProblem('short', fetchImpl)).toMatch(/at least 12/);
    expect(await passwordProblem('x'.repeat(129), fetchImpl)).toMatch(/at most 128/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('profile rules', () => {
  it('accepts 3-30 character usernames that start with a letter', () => {
    expect(usernameProblem('trailjane')).toBeNull();
    expect(usernameProblem('a_b-c9')).toBeNull();
    expect(usernameProblem('ab')).toMatch(/3 to 30/);
    expect(usernameProblem('9lives')).toMatch(/starting with a letter/);
    expect(usernameProblem('has space')).toMatch(/3 to 30/);
    expect(usernameProblem('Admin')).toMatch(/reserved/);
  });

  it('requires a name and a username when showing by username', () => {
    expect(parseProfile({ name: '  ' }).error).toMatch(/Enter your name/);
    expect(parseProfile(null).error).toMatch(/Enter your name/);
    expect(parseProfile({ name: 'Jane', displayPreference: 'username' }).error).toMatch(/Choose a username/);
    expect(parseProfile({ name: ' Jane   Hiker ', username: '' }).profile)
      .toEqual({ name: 'Jane Hiker', username: null, displayPreference: 'name' });
  });

  it('shows the username only when chosen, falling back to the email', () => {
    expect(displayNameOf({ name: 'Jane', username: 'tj', display_preference: 'username' })).toBe('tj');
    expect(displayNameOf({ name: 'Jane', username: 'tj', display_preference: 'name' })).toBe('Jane');
    expect(displayNameOf({ email: 'walker@example.com' })).toBe('walker');
  });
});
