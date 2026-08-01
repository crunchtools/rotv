import { describe, it, expect } from 'vitest';
import { findOrCreateUser } from '../config/userAccount.js';

const ADMIN_EMAIL = 'scott.mccarty@gmail.com';

/**
 * In-memory stand-in for the pg pool, matching only the queries userAccount.js
 * issues. Keeps the linking logic testable without a live PostgreSQL.
 */
function makeFakePool({ users = [], identities = [] } = {}) {
  const state = {
    users: users.map((u) => ({ is_admin: false, role: 'viewer', oauth_credentials: null, ...u })),
    identities: [...identities]
  };
  let nextUserId = Math.max(0, ...state.users.map((u) => u.id)) + 1;

  state.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT user_id FROM user_identities')) {
      const [provider, providerId] = params;
      const hit = state.identities.find((i) => i.provider === provider && i.provider_id === providerId);
      return { rows: hit ? [{ user_id: hit.user_id }] : [] };
    }

    if (s.startsWith('SELECT id FROM users WHERE LOWER(email)')) {
      const [email] = params;
      const hit = state.users.find((u) => u.email && u.email.toLowerCase() === String(email).toLowerCase());
      return { rows: hit ? [{ id: hit.id }] : [] };
    }

    if (s.startsWith('SELECT * FROM users WHERE id')) {
      const [id] = params;
      const hit = state.users.find((u) => u.id === id);
      return { rows: hit ? [{ ...hit }] : [] };
    }

    if (s.startsWith('INSERT INTO user_identities')) {
      const [userId, provider, providerId] = params;
      const clash = state.identities.some((i) => i.provider === provider && i.provider_id === providerId);
      if (!clash) state.identities.push({ user_id: userId, provider, provider_id: providerId });
      return { rows: [] };
    }

    if (s.startsWith('INSERT INTO users')) {
      const [email, name, pictureUrl, provider, providerId, isAdmin, role, credentials] = params;
      if (email && state.users.some((u) => u.email === email)) {
        throw new Error('duplicate key value violates unique constraint "users_email_key"');
      }
      const row = {
        id: nextUserId++,
        email,
        name,
        picture_url: pictureUrl,
        oauth_provider: provider,
        oauth_provider_id: providerId,
        is_admin: isAdmin,
        role,
        oauth_credentials: credentials
      };
      state.users.push(row);
      return { rows: [{ ...row }] };
    }

    if (s.startsWith('UPDATE users SET')) {
      const id = params[params.length - 1];
      const row = state.users.find((u) => u.id === id);
      const columns = [...s.matchAll(/(\w+) = \$(\d+)/g)];
      for (const [, column, index] of columns) {
        row[column] = params[Number(index) - 1];
      }
      return { rows: [] };
    }

    throw new Error(`unexpected query: ${s}`);
  };

  return state;
}

const googleProfile = {
  id: 'google-123',
  displayName: 'Scott McCarty',
  emails: [{ value: ADMIN_EMAIL }],
  photos: [{ value: 'https://google.example/avatar.jpg' }]
};

const facebookProfile = {
  id: 'facebook-987',
  displayName: 'Scott McCarty',
  emails: [{ value: ADMIN_EMAIL }],
  photos: [{ value: 'https://facebook.example/avatar.jpg' }]
};

describe('findOrCreateUser', () => {
  it('creates an account and its identity for a first-time login', async () => {
    const pool = makeFakePool();

    const user = await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);

    expect(user.email).toBe(ADMIN_EMAIL);
    expect(pool.users).toHaveLength(1);
    expect(pool.identities).toEqual([
      { user_id: user.id, provider: 'google', provider_id: 'google-123' }
    ]);
  });

  it('returns the same account on a repeat login without creating a second row', async () => {
    const pool = makeFakePool();

    const first = await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);
    const second = await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);

    expect(second.id).toBe(first.id);
    expect(pool.users).toHaveLength(1);
    expect(pool.identities).toHaveLength(1);
  });

  // The bug that blocked Facebook login: users.email is UNIQUE, so a second
  // provider used to hit a constraint violation instead of linking.
  it('links a Facebook login to the existing account with the same email', async () => {
    const pool = makeFakePool();
    const google = await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);

    const facebook = await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', facebookProfile, null);

    expect(facebook.id).toBe(google.id);
    expect(pool.users).toHaveLength(1);
    expect(pool.identities).toHaveLength(2);
  });

  it('matches emails case-insensitively when linking', async () => {
    const pool = makeFakePool();
    const google = await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);

    const shouty = { ...facebookProfile, emails: [{ value: ADMIN_EMAIL.toUpperCase() }] };
    const facebook = await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', shouty, null);

    expect(facebook.id).toBe(google.id);
    expect(pool.users).toHaveLength(1);
  });

  it('keeps the account reachable from either provider once linked', async () => {
    const pool = makeFakePool();
    const google = await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);
    await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', facebookProfile, null);

    const backViaGoogle = await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);
    const backViaFacebook = await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', facebookProfile, null);

    expect(backViaGoogle.id).toBe(google.id);
    expect(backViaFacebook.id).toBe(google.id);
    expect(pool.users).toHaveLength(1);
  });

  it('preserves admin Google credentials across a Facebook sign-in', async () => {
    const pool = makeFakePool();
    await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, { access_token: 'drive-token' });

    const linked = await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', facebookProfile, null);

    expect(JSON.parse(linked.oauth_credentials)).toEqual({ access_token: 'drive-token' });
    expect(linked.is_admin).toBe(true);
  });

  it('creates a separate account when Facebook withholds an email', async () => {
    const pool = makeFakePool();
    await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);

    const anonymous = { ...facebookProfile, emails: undefined };
    const created = await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', anonymous, null);

    expect(created.email).toBeNull();
    expect(created.is_admin).toBe(false);
    expect(pool.users).toHaveLength(2);
  });

  it('does not blank an existing avatar when a provider supplies none', async () => {
    const pool = makeFakePool();
    const google = await findOrCreateUser(pool, ADMIN_EMAIL, 'google', googleProfile, null);

    const noPhoto = { ...facebookProfile, photos: [] };
    const linked = await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', noPhoto, null);

    expect(linked.id).toBe(google.id);
    expect(linked.picture_url).toBe('https://google.example/avatar.jpg');
  });

  it('promotes a linked account to admin when the email matches ADMIN_EMAIL', async () => {
    const pool = makeFakePool({
      users: [{ id: 1, email: ADMIN_EMAIL, name: 'Scott', oauth_provider: 'google', oauth_provider_id: 'google-123' }],
      identities: [{ user_id: 1, provider: 'google', provider_id: 'google-123' }]
    });

    const linked = await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', facebookProfile, null);

    expect(linked.id).toBe(1);
    expect(linked.is_admin).toBe(true);
    expect(linked.role).toBe('admin');
  });

  it('leaves a non-admin login as a viewer', async () => {
    const pool = makeFakePool();
    const visitor = {
      id: 'facebook-555',
      displayName: 'Trail Visitor',
      emails: [{ value: 'visitor@example.com' }],
      photos: []
    };

    const created = await findOrCreateUser(pool, ADMIN_EMAIL, 'facebook', visitor, null);

    expect(created.is_admin).toBe(false);
    expect(created.role).toBe('viewer');
  });
});
