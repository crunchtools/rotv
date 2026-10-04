/**
 * Shared pieces of the /auth routes: rate limiters and session login.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { normalizeEmail } from '../services/emailLogin.js';

/** How recently someone must have signed in to change how they sign in. */
const FRESH_LOGIN_MS = 15 * 60 * 1000;

/**
 * A rate limiter that answers with the shared sign-in message.
 * @param {number} windowMs
 * @param {number} max
 * @param {(req: import('express').Request) => string} keyGenerator
 */
export function limiter(windowMs, max, keyGenerator) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator,
    message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false
  });
}

/**
 * Rate-limit key for per-address limits: the normalized email from the body,
 * so case or spacing can't dodge them.
 * @param {import('express').Request} req
 * @returns {string} `email:<address>`, or `email:invalid`
 */
export const emailKey = (req) => `email:${normalizeEmail(req.body?.email) || 'invalid'}`;

/**
 * Rate-limit key for per-client limits (IPv6 grouped by /56, per express-rate-limit).
 * @param {import('express').Request} req
 * @returns {string}
 */
export const ipKey = (req) => ipKeyGenerator(req.ip);

/**
 * Mark the current session as freshly signed in. Changing a password or
 * passkey requires a sign-in within FRESH_LOGIN_MS.
 * @param {import('express').Request} req
 */
export function stampLogin(req) {
  req.session.authAt = Date.now();
}

/**
 * Sign a user in (passport regenerates the session) and stamp it.
 * @param {import('express').Request} req
 * @param {object} user - users row
 * @returns {Promise<void>}
 */
export function completeLogin(req, user) {
  return new Promise((resolve, reject) => {
    req.login(user, (err) => {
      if (err) return reject(err);
      stampLogin(req);
      resolve();
    });
  });
}

/** Rejects with 403 unless the session signed in within FRESH_LOGIN_MS. */
export function requireFreshLogin(req, res, next) {
  if (Date.now() - (req.session?.authAt || 0) > FRESH_LOGIN_MS) {
    return res.status(403).json({
      error: 'For your security, log in again before changing how you sign in.',
      reauth: true
    });
  }
  next();
}
