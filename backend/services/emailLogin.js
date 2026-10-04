/**
 * Account emails (specs 045, 046): confirming a new account's address and
 * resetting a forgotten password. Each email carries one single-use link
 * (a 32-byte random token); only its SHA-256 digest is stored.
 *
 * Confirmation links last 7 days. Password-reset links last the admin-set
 * lifetime (admin_settings.email_login_ttl_minutes, default 30).
 */

import crypto from 'crypto';
import { escapeHtml } from '../utils/html.js';

const TTL_DEFAULT_MINUTES = 30;
export const TTL_MIN_MINUTES = 5;
export const TTL_MAX_MINUTES = 60;
const CONFIRM_TTL_MINUTES = 7 * 24 * 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** SHA-256 hex digest of a link token; 256 random bits need no key. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Trim and lowercase; returns null if it isn't a plausible address. */
export function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

const KINDS = {
  confirm: {
    path: '/signin',
    subject: 'Confirm your email for Roots of the Valley',
    heading: 'Confirm your email',
    intro: 'Thanks for creating a Roots of the Valley account. Confirm your email address:',
    button: 'Confirm my email',
    ignore: "If you didn't create this account, you can ignore this email."
  },
  reset: {
    path: '/reset-password',
    subject: 'Reset your Roots of the Valley password',
    heading: 'Reset your password',
    intro: 'Someone asked to reset the password for your Roots of the Valley account. Choose a new one here:',
    button: 'Reset my password',
    ignore: "If you didn't ask for this, you can ignore this email. Your password stays the same."
  }
};

/**
 * Store a single-use link and email it.
 * @param {import('pg').Pool} pool
 * @param {{send: Function}} mailer - from createMailer()
 * @param {string} email - already normalized
 * @param {string} baseUrl - site origin for the link, e.g. https://rootsofthevalley.org
 * @param {'confirm'|'reset'} kind - confirm a new account's email, or reset a password
 * @returns {Promise<void>} rejects if the row can't be stored or the mail can't be handed off
 */
export async function sendAccountEmail(pool, mailer, email, baseUrl, kind) {
  const token = crypto.randomBytes(32).toString('base64url');
  let ttlMinutes = CONFIRM_TTL_MINUTES;
  if (kind === 'reset') {
    // Admin-set lifetime (Settings › Users), clamped to the allowed range.
    const setting = await pool.query(`SELECT value FROM admin_settings WHERE key = 'email_login_ttl_minutes'`);
    const minutes = parseInt(setting.rows[0]?.value, 10);
    ttlMinutes = Number.isFinite(minutes)
      ? Math.min(TTL_MAX_MINUTES, Math.max(TTL_MIN_MINUTES, minutes))
      : TTL_DEFAULT_MINUTES;
  }
  await pool.query(`DELETE FROM email_login_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`);
  await pool.query(
    `INSERT INTO email_login_tokens (email, token_hash, expires_at, purpose)
     VALUES ($1, $2, NOW() + make_interval(mins => $3), $4)`,
    [email, hashToken(token), ttlMinutes, kind]
  );
  // Fragment, not query: browsers never send it to the server, so the token
  // stays out of proxy access logs and analytics.
  const link = `${baseUrl}${KINDS[kind].path}#token=${encodeURIComponent(token)}`;
  const copy = KINDS[kind];
  const lifetime = ttlMinutes % (24 * 60) === 0 ? `${ttlMinutes / (24 * 60)} days` : `${ttlMinutes} minutes`;
  const text = [copy.heading, '', `${copy.intro}\n${link}`, '', `The link works once and expires in ${lifetime}.`, copy.ignore].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1b4332;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${copy.heading}</h2>
<p>${escapeHtml(copy.intro)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#2d6a4f;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${copy.button}</a></p>
<p style="color:#525252;font-size:13px">The link works once and expires in ${lifetime}. ${escapeHtml(copy.ignore)}</p>
</body></html>`;
  await mailer.send({ to: email, subject: copy.subject, text, html });
}

/**
 * Use up a link token of the given kind.
 * @param {import('pg').Pool} pool
 * @param {string} token
 * @param {'confirm'|'reset'} kind - a token only works for the kind it was sent as
 * @returns {Promise<string|null>} the email it was sent to, or null if invalid, used, or expired
 */
export async function consumeToken(pool, token, kind) {
  if (!token) return null;
  const consumed = await pool.query(
    `UPDATE email_login_tokens SET consumed_at = NOW()
     WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > NOW()
     RETURNING email`,
    [hashToken(token), kind]
  );
  return consumed.rows[0]?.email ?? null;
}
