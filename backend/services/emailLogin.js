/**
 * Passwordless email sign-in (spec 045).
 *
 * A request emails one message carrying both a link token (32 random bytes)
 * and a 6-digit code. Either signs the person in once, within the admin-set
 * lifetime (admin_settings.email_login_ttl_minutes, default 30).
 * Only digests are stored: SHA-256 for tokens, a keyed HMAC for codes.
 * Wrong codes count against the request; after
 * MAX_CODE_ATTEMPTS the request's code stops working (the link still does,
 * since its 256-bit token can't be guessed).
 */

import crypto from 'crypto';
import { escapeHtml } from '../utils/html.js';

const TTL_DEFAULT_MINUTES = 30;
export const TTL_MIN_MINUTES = 5;
export const TTL_MAX_MINUTES = 60;
export const MAX_CODE_ATTEMPTS = 5;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** SHA-256 hex digest of a link token; 256 random bits need no key. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

let processKey = null;

/**
 * Keyed digest of a 6-digit code. A million codes can be tried offline in
 * milliseconds, so a plain hash would let anyone holding a database copy
 * recover live codes; the key lives in the environment, not the database.
 * Bound to the address so a digest is useless for any other account.
 */
function hashCode(email, code) {
  // Key derived from SESSION_SECRET. Without one (dev), a random per-process
  // key: codes stop working on restart, but are never checkable with a known key.
  const key = process.env.SESSION_SECRET
    ? crypto.createHmac('sha256', process.env.SESSION_SECRET).update('rotv-email-login-code').digest()
    : (processKey ??= crypto.randomBytes(32));
  return crypto.createHmac('sha256', key).update(`${email}:${code}`).digest('hex');
}

/** Trim and lowercase; returns null if it isn't a plausible address. */
export function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function renderEmail({ link, code, ttlMinutes }) {
  const text = [
    'Sign in to Roots of the Valley',
    '',
    `Open this link to sign in:\n${link}`,
    '',
    `Or enter this code: ${code}`,
    '',
    `The link and code work once and expire in ${ttlMinutes} minutes.`,
    "If you didn't ask to sign in, ignore this email. Nobody can sign in without it."
  ].join('\n');
  const safeLink = escapeHtml(link);
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1b4332;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">Sign in to Roots of the Valley</h2>
<p><a href="${safeLink}" style="display:inline-block;background:#2d6a4f;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Sign in</a></p>
<p>Or enter this code:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:bold;margin:8px 0 16px">${code}</p>
<p style="color:#525252;font-size:13px">The link and code work once and expire in ${ttlMinutes} minutes. If you didn't ask to sign in, ignore this email. Nobody can sign in without it.</p>
</body></html>`;
  return { text, html };
}

/**
 * Link/code lifetime from admin_settings, clamped to the allowed range.
 * @param {import('pg').Pool} pool
 * @returns {Promise<number>} minutes
 */
async function loginTtlMinutes(pool) {
  const setting = await pool.query(`SELECT value FROM admin_settings WHERE key = 'email_login_ttl_minutes'`);
  const minutes = parseInt(setting.rows[0]?.value, 10);
  if (!Number.isFinite(minutes)) return TTL_DEFAULT_MINUTES;
  return Math.min(TTL_MAX_MINUTES, Math.max(TTL_MIN_MINUTES, minutes));
}

/**
 * Create a sign-in request and email it.
 * @param {import('pg').Pool} pool
 * @param {{send: Function}} mailer - from createMailer()
 * @param {string} email - already normalized
 * @param {string} baseUrl - site origin for the link, e.g. https://rootsofthevalley.org
 * @returns {Promise<void>} rejects if the row can't be stored or the mail can't be handed off
 */
export async function requestLogin(pool, mailer, email, baseUrl) {
  const token = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

  const ttlMinutes = await loginTtlMinutes(pool);
  await pool.query(`DELETE FROM email_login_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`);
  await pool.query(
    `INSERT INTO email_login_tokens (email, token_hash, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [email, hashToken(token), hashCode(email, code), ttlMinutes]
  );

  // Fragment, not query: browsers never send it to the server, so the token
  // stays out of proxy access logs and analytics.
  const link = `${baseUrl}/signin#token=${encodeURIComponent(token)}`;
  await mailer.send({ to: email, subject: `Your Roots of the Valley sign-in code: ${code}`, ...renderEmail({ link, code, ttlMinutes }) });
}

/**
 * Consume a link token. Returns the email it was issued to, or null.
 * @param {import('pg').Pool} pool
 * @param {string} token
 */
export async function verifyToken(pool, token) {
  if (!token) return null;
  const consumed = await pool.query(
    `UPDATE email_login_tokens SET consumed_at = NOW()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
     RETURNING email`,
    [hashToken(token)]
  );
  return consumed.rows[0]?.email ?? null;
}

/**
 * Consume a 6-digit code for an email. Only the newest live request for that
 * address is eligible, so an older email can't be brute-forced in parallel.
 * Returns the email on success, or null.
 * @param {import('pg').Pool} pool
 * @param {string} email - already normalized
 * @param {string} code
 */
export async function verifyCode(pool, email, code) {
  if (!email || !/^\d{6}$/.test(String(code || ''))) return null;
  // The outer conditions repeat the subquery's: after waiting on a row lock,
  // PostgreSQL rechecks only the outer WHERE, so this is what makes a code
  // single-use under concurrent requests.
  const consumed = await pool.query(
    `UPDATE email_login_tokens SET consumed_at = NOW()
     WHERE id = (
       SELECT id FROM email_login_tokens
       WHERE email = $1 AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC, id DESC LIMIT 1
     )
     AND consumed_at IS NULL AND expires_at > NOW()
     AND code_hash = $2 AND attempts < $3
     RETURNING email`,
    [email, hashCode(email, code), MAX_CODE_ATTEMPTS]
  );
  if (consumed.rows[0]) return consumed.rows[0].email;

  await pool.query(
    `UPDATE email_login_tokens SET attempts = attempts + 1
     WHERE id = (
       SELECT id FROM email_login_tokens
       WHERE email = $1 AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC, id DESC LIMIT 1
     )`,
    [email]
  );
  return null;
}
