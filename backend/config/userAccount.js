/**
 * Resolves an OAuth login to a ROTV user account.
 *
 * Logins live in `user_identities`, so one account can carry both a Google and a
 * Facebook identity. When an unrecognised identity arrives with an email that
 * already belongs to an account, it is linked to that account instead of
 * creating a second one — `users.email` is UNIQUE, so the previous
 * create-always path threw a constraint violation the first time an existing
 * user signed in through a second provider.
 *
 * Linking trusts the email the provider asserts. Google and Facebook both
 * verify addresses before releasing them, so this matches the account-linking
 * behaviour users expect from "sign in with X" buttons.
 *
 * `users.oauth_provider` / `oauth_provider_id` are left pointing at whichever
 * provider created the account. They are no longer the lookup key, but the
 * admin user list still reports them as the account's origin.
 */
export async function findOrCreateUser(pool, adminEmail, provider, profile, credentials) {
  const email = profile.emails?.[0]?.value || null;
  const name = profile.displayName || null;
  const pictureUrl = profile.photos?.[0]?.value || null;
  const providerId = profile.id;
  const isAdmin = Boolean(email && email.toLowerCase() === adminEmail.toLowerCase());

  const identity = await pool.query(
    'SELECT user_id FROM user_identities WHERE provider = $1 AND provider_id = $2',
    [provider, providerId]
  );
  let userId = identity.rows[0]?.user_id ?? null;

  if (!userId && email) {
    const byEmail = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    userId = byEmail.rows[0]?.id ?? null;

    if (userId) {
      await pool.query(
        `INSERT INTO user_identities (user_id, provider, provider_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, provider_id) DO NOTHING`,
        [userId, provider, providerId]
      );
    }
  }

  if (!userId) {
    const role = isAdmin ? 'admin' : 'viewer';
    const created = await pool.query(
      `INSERT INTO users (email, name, picture_url, oauth_provider, oauth_provider_id, is_admin, role, oauth_credentials, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING *`,
      [email, name, pictureUrl, provider, providerId, isAdmin, role, isAdmin && credentials ? JSON.stringify(credentials) : null]
    );

    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, provider_id) DO NOTHING`,
      [created.rows[0].id, provider, providerId]
    );

    return created.rows[0];
  }

  const existing = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const current = existing.rows[0];

  const updateFields = ['last_login_at = CURRENT_TIMESTAMP'];
  const updateValues = [];

  // Only overwrite when this provider actually supplied a value, so signing in
  // through a sparser profile cannot blank out a good name or avatar.
  if (pictureUrl) {
    updateValues.push(pictureUrl);
    updateFields.push(`picture_url = $${updateValues.length}`);
  }
  if (name) {
    updateValues.push(name);
    updateFields.push(`name = $${updateValues.length}`);
  }

  if (isAdmin && !current.is_admin) {
    updateValues.push(true);
    updateFields.push(`is_admin = $${updateValues.length}`);
    updateValues.push('admin');
    updateFields.push(`role = $${updateValues.length}`);
  }

  // Facebook logins carry no credentials, so a Facebook sign-in must never wipe
  // the Google tokens the admin Drive integration depends on.
  if (isAdmin && credentials) {
    updateValues.push(JSON.stringify(credentials));
    updateFields.push(`oauth_credentials = $${updateValues.length}`);
  }

  updateValues.push(userId);
  await pool.query(
    `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${updateValues.length}`,
    updateValues
  );

  const refreshed = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return refreshed.rows[0];
}
