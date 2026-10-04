/**
 * Public profile rules (spec 046): usernames and how a person appears.
 */

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,29}$/;
const NAME_MAX = 100;

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'rotv', 'rootsofthevalley', 'support', 'help',
  'moderator', 'mod', 'staff', 'system', 'official', 'newsletter', 'signin', 'signup',
  'login', 'logout', 'settings', 'privacy', 'terms', 'api', 'auth', 'null', 'undefined'
]);

/**
 * Check a requested username.
 * @param {string} username - already trimmed
 * @returns {string|null} an error message, or null when the format is acceptable
 *   (uniqueness is checked against the database separately)
 */
export function usernameProblem(username) {
  if (!USERNAME_PATTERN.test(username)) {
    return 'Usernames are 3 to 30 letters, numbers, dashes or underscores, starting with a letter.';
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return 'That username is reserved. Please choose another.';
  }
  return null;
}

/**
 * Normalize and validate the profile fields shared by sign-up, finishing
 * sign-up, and Settings.
 * @param {{name?: string, username?: string, displayPreference?: string}} input
 * @returns {{profile?: {name: string, username: string|null, displayPreference: 'name'|'username'}, error?: string}}
 */
export function parseProfile({ name, username, displayPreference } = {}) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!cleanName) return { error: 'Enter your name.' };
  if (cleanName.length > NAME_MAX) return { error: `Names can be up to ${NAME_MAX} characters.` };

  const cleanUsername = String(username || '').trim() || null;
  if (cleanUsername) {
    const problem = usernameProblem(cleanUsername);
    if (problem) return { error: problem };
  }

  const preference = displayPreference === 'username' ? 'username' : 'name';
  if (preference === 'username' && !cleanUsername) {
    return { error: 'Choose a username to be shown by it.' };
  }
  return { profile: { name: cleanName, username: cleanUsername, displayPreference: preference } };
}

/**
 * The name to show for an account: the username when the person chose it,
 * otherwise their name, falling back to the email's local part.
 * @param {{name?: string, username?: string, display_preference?: string, email?: string}} user - a users row
 * @returns {string|null}
 */
export function displayNameOf(user) {
  if (user.display_preference === 'username' && user.username) return user.username;
  return user.name || user.email?.split('@')[0] || null;
}

/**
 * Whether a username is free, ignoring case.
 * @param {import('pg').Pool} pool
 * @param {string} username
 * @param {number|null} [exceptUserId] - the account changing its own username
 */
export async function usernameAvailable(pool, username, exceptUserId = null) {
  const taken = await pool.query(
    'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) AND id IS DISTINCT FROM $2',
    [username, exceptUserId]
  );
  return taken.rows.length === 0;
}
