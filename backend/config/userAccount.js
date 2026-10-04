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
 *
 * Accounts created with email and a password or passkey (spec 046) are usable
 * before their address is confirmed. Such an account may have been created by
 * someone who doesn't own the address, waiting for the owner to sign in with
 * Google and land in it (account pre-hijacking). So when a verified sign-in
 * reaches an unconfirmed account, the verified owner takes it over: passwords,
 * passkeys and sessions added before confirmation are removed. (The account's
 * own confirmation link doesn't come through here: it only marks the address
 * confirmed and keeps the creator's sign-in methods.)
 */
/** The account that is made admin on sign-in (ADMIN_EMAIL, defaulting to the maintainer). */
export function adminEmail() {
  return process.env.ADMIN_EMAIL || 'scott.mccarty@gmail.com';
}

/**
 * Remove every way into an account that was added before its email was
 * confirmed, and end its sessions.
 * @param {import('pg').Pool} pool
 * @param {number} userId
 * @param {string} email - the account's address, whose pending confirmation links are voided
 */
async function revokeUnverifiedAccess(pool, userId, email) {
  await pool.query('DELETE FROM user_passwords WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM user_passkeys WHERE user_id = $1', [userId]);
  await pool.query(`DELETE FROM sessions WHERE sess -> 'passport' ->> 'user' = $1`, [String(userId)]);
  // A newsletter opt-in from before confirmation isn't the owner's consent.
  await pool.query('UPDATE users SET newsletter_opt_in = FALSE WHERE id = $1', [userId]);
  // Fix: void the sign-up's pending confirmation links, which would otherwise
  // still sign their holder in without revoking anything (PR #714 review).
  await pool.query(
    `UPDATE email_login_tokens SET consumed_at = NOW()
     WHERE LOWER(email) = LOWER($1) AND purpose = 'confirm' AND consumed_at IS NULL`,
    [email]
  );
}

/**
 * Resolve a verified sign-in (Google, Facebook, or an emailed link/code) to an
 * account, creating one when needed.
 * @param {import('pg').Pool} pool
 * @param {string} adminEmail
 * @param {string} provider - 'google' | 'facebook' | 'email'
 * @param {object} profile - passport-style profile: id, displayName, emails, photos
 * @param {object|null} credentials - Google Drive tokens for the admin upgrade flow
 * @returns {Promise<object>} the users row; `credentialsReset` is true when
 *   credentials added before confirmation were removed
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
  let credentialsReset = false;

  if (!userId && email) {
    const byEmail = await pool.query(
      'SELECT id, email_verified_at FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    userId = byEmail.rows[0]?.id ?? null;

    if (userId && !byEmail.rows[0].email_verified_at) {
      await revokeUnverifiedAccess(pool, userId, email);
      credentialsReset = true;
    }

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
      `INSERT INTO users (email, name, picture_url, oauth_provider, oauth_provider_id, is_admin, role, oauth_credentials, last_login_at, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CASE WHEN $9 THEN NOW() END)
       RETURNING *`,
      [email, name, pictureUrl, provider, providerId, isAdmin, role, isAdmin && credentials ? JSON.stringify(credentials) : null, Boolean(email)]
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

  // The provider just proved the address, so the account counts as confirmed.
  const updateFields = ['last_login_at = CURRENT_TIMESTAMP', 'email_verified_at = COALESCE(email_verified_at, NOW())'];
  const updateValues = [];

  // Only fill in what this provider actually supplied, so signing in through a
  // sparser profile cannot blank out a good avatar. The name is only filled
  // when missing: people choose it at sign-up and in Settings.
  if (pictureUrl) {
    updateValues.push(pictureUrl);
    updateFields.push(`picture_url = $${updateValues.length}`);
  }
  if (name && !current.name) {
    updateValues.push(name);
    updateFields.push(`name = $${updateValues.length}`);
  }

  if (isAdmin && !current.is_admin) {
    // Admins don't keep passwords; one set before promotion is removed.
    await pool.query('DELETE FROM user_passwords WHERE user_id = $1', [userId]);
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
  return { ...refreshed.rows[0], credentialsReset };
}
