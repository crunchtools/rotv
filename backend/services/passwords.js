/**
 * Password storage and policy (spec 046).
 *
 * Hashes use Node's built-in scrypt at one of OWASP's recommended costs
 * (N=2^15, r=8, p=3: 32 MiB per hash) and a random 16-byte salt. The stored string carries its own
 * parameters (`scrypt$N$r$p$salt$hash`), so the cost can be raised later and
 * old hashes upgraded on the next successful login.
 *
 * Policy follows NIST SP 800-63B: 12 to 128 characters, no composition rules,
 * and no passwords known from breaches. The breach check uses the Have I Been
 * Pwned range API: only the first five hex characters of the SHA-1 leave the
 * server (k-anonymity). If the API can't be reached, the check is skipped.
 */

import crypto from 'crypto';
import { promisify } from 'util';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Passwords');
const scrypt = promisify(crypto.scrypt);

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

// Of OWASP's equivalent scrypt settings, the 32 MiB one: scrypt runs on the
// libuv thread pool (UV_THREADPOOL_SIZE, 4 unless configured; ROTV doesn't),
// so with the default at most ~128 MiB is in use however many sign-ins arrive.
const COST = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 32;
const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

async function derive(password, salt, cost) {
  // scrypt needs 128 * N * r * p bytes; Node's default 32 MB cap is below that.
  const maxmem = 128 * cost.N * cost.r * cost.p + 1024 * 1024;
  return scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...cost, maxmem });
}

/**
 * Hash a password for storage.
 * @param {string} password
 * @returns {Promise<string>} `scrypt$N$r$p$saltB64$hashB64`
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

// Verified against when an account has no password, so a missing password
// costs the same time as a wrong one and response timing reveals nothing.
// Made on first use so importing this module costs nothing.
let dummyHash = null;

/**
 * Check a password against a stored hash.
 * @param {string} password
 * @param {string|null} stored - from user_passwords.hash, or null when the account has none
 * @returns {Promise<{ok: boolean, needsRehash: boolean}>}
 *   needsRehash is true when the hash used weaker parameters than today's.
 */
export async function verifyPassword(password, stored) {
  dummyHash ??= hashPassword(crypto.randomBytes(18).toString('base64'));
  const [scheme, N, r, p, saltB64, hashB64] = (stored || await dummyHash).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return { ok: false, needsRehash: false };
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await derive(String(password), Buffer.from(saltB64, 'base64'), cost);
  const ok = Boolean(stored) && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  const needsRehash = ok && (cost.N < COST.N || cost.r < COST.r || cost.p < COST.p);
  return { ok, needsRehash };
}

/**
 * How many times a password appears in the Have I Been Pwned corpus.
 * @param {string} password
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<number|null>} the count, or null when the API is unreachable
 */
export async function breachCount(password, fetchImpl = fetch) {
  // Fix: check the same NFKC form that gets hashed and stored (PR review).
  const sha1 = crypto.createHash('sha1').update(password.normalize('NFKC')).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetchImpl(`${PWNED_RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'RootsOfTheValley/1.0 (+https://rootsofthevalley.org)' },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    for (const line of body.split('\n')) {
      const [hashSuffix, count] = line.trim().split(':');
      if (hashSuffix === suffix) return parseInt(count, 10) || 0;
    }
    return 0;
  } catch (err) {
    logger.warn(`Breached-password check skipped: ${err.message}`);
    return null;
  }
}

/**
 * Validate a new password against the policy.
 * @param {string} password
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string|null>} an error message for the person, or null when acceptable
 */
export async function passwordProblem(password, fetchImpl = fetch) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters. A few unrelated words works well.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Use at most ${PASSWORD_MAX} characters.`;
  }
  const seen = await breachCount(password, fetchImpl);
  if (seen) {
    return 'That password has appeared in a data breach elsewhere. Please choose a different one.';
  }
  return null;
}
