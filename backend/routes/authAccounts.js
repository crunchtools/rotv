/**
 * Account routes for sign-up, passwords and passkeys (spec 046), mounted on
 * the /auth router.
 *
 * Email sign-ups can be used immediately and confirmed later (see
 * config/userAccount.js for how unconfirmed accounts are protected against
 * pre-hijacking). Changing a password or passkey requires a recent sign-in.
 * Admin accounts can't have a password: the admin signs in with Google (for
 * the Drive integration) or a passkey, so there's no admin password to guess.
 */

import express from 'express';
import { createLogger } from '../utils/logger.js';
import { isAuthenticated } from '../middleware/auth.js';
import { limiter, ipKey, emailKey, completeLogin, requireFreshLogin } from '../utils/authSession.js';
import { normalizeEmail, requestLogin } from '../services/emailLogin.js';
import { hashPassword, verifyPassword, passwordProblem } from '../services/passwords.js';
import { parseProfile, usernameProblem, usernameAvailable } from '../services/accountProfile.js';
import {
  registrationOptions, finishRegistration, authenticationOptions, finishAuthentication, passkeyLabel
} from '../services/passkeys.js';
import { releaseNewsletterOptIn } from '../services/signupNewsletter.js';

const logger = createLogger('AuthAccounts');

const LOGIN_FAILED = 'Email or password is incorrect.';
const PASSKEY_FAILED = "That passkey didn't work. Try again, or sign in another way.";
const SIGNIN_FAILED = 'Sign-in failed. Please try again.';
const ACCOUNT_EXISTS = 'An account with that email or username already exists. Sign in instead, or use “Email me a sign-in code”.';
const CONSENT_REQUIRED = 'Please confirm you are 13 or older and agree to the Terms of Use and Privacy Policy.';

const userKey = (req) => `user:${req.user?.id}`;

// Account owners may change sign-in methods; admins may not hold a password.
function refuseAdminPassword(req, res, next) {
  if (req.user.is_admin || req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admin accounts sign in with Google or a passkey, not a password.' });
  }
  next();
}

/** Pick the consent fields shared by sign-up and finishing sign-up. */
function consentsFrom(body) {
  return {
    ageConfirmed: body?.ageConfirmed === true,
    termsAccepted: body?.termsAccepted === true,
    newsletter: body?.newsletter === true
  };
}

/**
 * Attach the sign-up, password and passkey routes to the /auth router.
 * @param {import('express').Router} router
 * @param {import('pg').Pool} pool
 * @param {{mailer: {enabled: boolean, send: Function}, frontendUrl: string}} deps
 */
export function addAccountRoutes(router, pool, { mailer, frontendUrl }) {
  const sendConfirmation = async (email) => {
    if (!mailer.enabled) return;
    try {
      await requestLogin(pool, mailer, email, frontendUrl, { purpose: 'confirm' });
    } catch (err) {
      // Sign-up still succeeds; the banner's "Resend" covers a failed send.
      logger.error(`Confirmation email failed: ${err.code || err.name} ${err.responseCode || ''}`.trim());
    }
  };

  router.get('/username-available',
    limiter(15 * 60 * 1000, 60, ipKey),
    async (req, res) => {
      const username = String(req.query.username || '').trim();
      const problem = usernameProblem(username);
      if (problem) return res.json({ available: false, error: problem });
      try {
        const available = await usernameAvailable(pool, username, req.user?.id ?? null);
        res.json({ available, error: available ? null : 'That username is taken.' });
      } catch (err) {
        logger.error(`Username availability check failed: ${err.code || err.name}`);
        res.status(500).json({ error: 'Could not check that username right now.' });
      }
    });

  router.post('/signup',
    express.json(),
    limiter(60 * 60 * 1000, 10, ipKey),
    limiter(15 * 60 * 1000, 3, emailKey),
    async (req, res) => {
      const body = req.body || {};
      const email = normalizeEmail(body.email);
      if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });

      const { profile, error } = parseProfile(body);
      if (error) return res.status(400).json({ error });

      const consents = consentsFrom(body);
      if (!consents.ageConfirmed || !consents.termsAccepted) {
        return res.status(400).json({ error: CONSENT_REQUIRED });
      }

      const method = body.method === 'passkey' ? 'passkey' : 'password';
      if (method === 'password') {
        const problem = await passwordProblem(body.password);
        if (problem) return res.status(400).json({ error: problem });
      }
      let user;
      let client = null;
      try {
        if (profile.username && !(await usernameAvailable(pool, profile.username))) {
          return res.status(409).json({ error: 'That username is taken.' });
        }
        // users.email is unique ignoring case, but older OAuth rows may differ in
        // case from the normalized address, so check before inserting.
        const existing = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [email]);
        if (existing.rows.length) {
          return res.status(409).json({ error: ACCOUNT_EXISTS });
        }

        const passwordHash = method === 'password' ? await hashPassword(body.password) : null;
        // Fix: the account and its password are created together or not at all
        // (PR #714 review).
        client = await pool.connect();
        await client.query('BEGIN');
        const created = await client.query(
          `INSERT INTO users (email, name, username, display_preference, oauth_provider, oauth_provider_id,
                              is_admin, role, terms_accepted_at, age_confirmed_at, newsletter_opt_in,
                              signup_completed_at, last_login_at)
           VALUES ($1, $2, $3, $4, $5, $1, FALSE, 'viewer', NOW(), NOW(), $6, NOW(), NOW())
           RETURNING *`,
          [email, profile.name, profile.username, profile.displayPreference, method, consents.newsletter]
        );
        user = created.rows[0];
        if (passwordHash) {
          await client.query('INSERT INTO user_passwords (user_id, hash) VALUES ($1, $2)', [user.id, passwordHash]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client?.query('ROLLBACK').catch((rollbackErr) =>
          logger.error(`Sign-up rollback failed: ${rollbackErr.code || rollbackErr.name}`));
        if (err.code === '23505') {
          // The email (or username) already belongs to an account. Sign-ups are
          // usable immediately, so this can't be hidden the way sign-in hides it.
          return res.status(409).json({ error: ACCOUNT_EXISTS });
        }
        logger.error(`Sign-up failed: ${err.code || err.name}`);
        return res.status(500).json({ error: 'Sign-up failed. Please try again.' });
      } finally {
        client?.release();
      }

      try {
        await completeLogin(req, user);
      } catch (err) {
        logger.error(`Session login after sign-up failed: ${err.code || err.name}`);
        return res.status(500).json({ error: SIGNIN_FAILED });
      }
      await sendConfirmation(email);
      res.status(201).json({ success: true, method });
    });

  router.post('/password/login',
    express.json(),
    limiter(15 * 60 * 1000, 10, ipKey),
    limiter(15 * 60 * 1000, 5, emailKey),
    async (req, res) => {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      try {
        const found = email
          ? await pool.query(
            `SELECT u.*, p.hash AS password_hash FROM users u
             LEFT JOIN user_passwords p ON p.user_id = u.id
             WHERE LOWER(u.email) = $1`,
            [email]
          )
          : { rows: [] };
        const row = found.rows[0];
        const { ok, needsRehash } = await verifyPassword(password, row?.password_hash || null);
        // Fix: admins never sign in by password, even if one predates their
        // promotion (PR review). Same answer as a wrong password.
        if (!row || !ok || row.is_admin || row.role === 'admin') return res.status(401).json({ error: LOGIN_FAILED });

        if (needsRehash) {
          await pool.query('UPDATE user_passwords SET hash = $1, updated_at = NOW() WHERE user_id = $2',
            [await hashPassword(password), row.id]);
        }
        await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id]);
        const user = { ...row };
        delete user.password_hash;
        await completeLogin(req, user);
        res.json({ success: true });
      } catch (err) {
        logger.error(`Password sign-in failed: ${err.code || err.name}`);
        res.status(500).json({ error: SIGNIN_FAILED });
      }
    });

  router.put('/password',
    isAuthenticated, express.json(), refuseAdminPassword, requireFreshLogin,
    async (req, res) => {
      const problem = await passwordProblem(req.body?.password);
      if (problem) return res.status(400).json({ error: problem });
      try {
        await pool.query(
          `INSERT INTO user_passwords (user_id, hash) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = NOW()`,
          [req.user.id, await hashPassword(req.body.password)]
        );
        res.json({ success: true });
      } catch (err) {
        logger.error(`Setting password for user ${req.user.id} failed: ${err.code || err.name}`);
        res.status(500).json({ error: 'Could not save the password. Please try again.' });
      }
    });

  router.delete('/password', isAuthenticated, requireFreshLogin, async (req, res) => {
    try {
      await pool.query('DELETE FROM user_passwords WHERE user_id = $1', [req.user.id]);
      res.json({ success: true });
    } catch (err) {
      logger.error(`Removing password for user ${req.user.id} failed: ${err.code || err.name}`);
      res.status(500).json({ error: 'Could not remove the password. Please try again.' });
    }
  });

  router.get('/methods', isAuthenticated, async (req, res) => {
    let password;
    let passkeys;
    try {
      [password, passkeys] = await Promise.all([
        pool.query('SELECT updated_at FROM user_passwords WHERE user_id = $1', [req.user.id]),
        pool.query(
          `SELECT id, name, created_at, last_used_at FROM user_passkeys
           WHERE user_id = $1 ORDER BY created_at`,
          [req.user.id]
        )
      ]);
    } catch (err) {
      logger.error(`Loading sign-in methods for user ${req.user.id} failed: ${err.code || err.name}`);
      return res.status(500).json({ error: 'Could not load your sign-in methods. Please try again.' });
    }
    res.json({
      hasPassword: password.rows.length > 0,
      passwordAllowed: !(req.user.is_admin || req.user.role === 'admin'),
      passkeys: passkeys.rows.map((row) => ({
        id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at
      }))
    });
  });

  router.post('/passkey/register/options', isAuthenticated, requireFreshLogin, async (req, res) => {
    try {
      res.json(await registrationOptions(pool, req.session, req.user, frontendUrl));
    } catch (err) {
      logger.error(`Passkey registration options failed: ${err.code || err.name}`);
      res.status(500).json({ error: 'Could not start passkey setup. Please try again.' });
    }
  });

  // Fix: freshness is checked again when the passkey is stored (PR #714 review).
  router.post('/passkey/register/verify', isAuthenticated, requireFreshLogin, express.json(), async (req, res) => {
    try {
      const passkey = await finishRegistration(pool, req.session, req.user, req.body?.response, req.body?.name, frontendUrl);
      if (!passkey) return res.status(400).json({ error: "The passkey couldn't be saved. Please try again." });
      res.status(201).json({ success: true, passkey });
    } catch (err) {
      logger.error(`Passkey registration failed: ${err.code || err.name}`);
      res.status(500).json({ error: "The passkey couldn't be saved. Please try again." });
    }
  });

  router.post('/passkey/login/options', limiter(15 * 60 * 1000, 30, ipKey), async (req, res) => {
    try {
      res.json(await authenticationOptions(req.session, frontendUrl));
    } catch (err) {
      logger.error(`Passkey sign-in options failed: ${err.code || err.name}`);
      res.status(500).json({ error: SIGNIN_FAILED });
    }
  });

  router.post('/passkey/login/verify',
    express.json(),
    limiter(15 * 60 * 1000, 30, ipKey),
    async (req, res) => {
      try {
        const userId = await finishAuthentication(pool, req.session, req.body?.response, frontendUrl);
        if (!userId) return res.status(401).json({ error: PASSKEY_FAILED });
        const found = await pool.query(
          'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
          [userId]
        );
        await completeLogin(req, found.rows[0]);
        res.json({ success: true });
      } catch (err) {
        logger.error(`Passkey sign-in failed: ${err.code || err.name}`);
        res.status(500).json({ error: SIGNIN_FAILED });
      }
    });

  router.patch('/passkeys/:id', isAuthenticated, express.json(), async (req, res) => {
    const name = passkeyLabel(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Give the passkey a name.' });
    try {
      const updated = await pool.query(
        'UPDATE user_passkeys SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id',
        [name, Number(req.params.id) || 0, req.user.id]
      );
      if (!updated.rows.length) return res.status(404).json({ error: 'Passkey not found.' });
      res.json({ success: true });
    } catch (err) {
      logger.error(`Renaming passkey for user ${req.user.id} failed: ${err.code || err.name}`);
      res.status(500).json({ error: 'Could not rename the passkey. Please try again.' });
    }
  });

  router.delete('/passkeys/:id', isAuthenticated, requireFreshLogin, async (req, res) => {
    try {
      const removed = await pool.query(
        'DELETE FROM user_passkeys WHERE id = $1 AND user_id = $2 RETURNING id',
        [Number(req.params.id) || 0, req.user.id]
      );
      if (!removed.rows.length) return res.status(404).json({ error: 'Passkey not found.' });
      res.json({ success: true });
    } catch (err) {
      logger.error(`Removing passkey for user ${req.user.id} failed: ${err.code || err.name}`);
      res.status(500).json({ error: 'Could not remove the passkey. Please try again.' });
    }
  });

  // Name, username and how the person appears.
  router.put('/profile', isAuthenticated, express.json(), async (req, res) => {
    const { profile, error } = parseProfile(req.body);
    if (error) return res.status(400).json({ error });
    try {
      if (profile.username && !(await usernameAvailable(pool, profile.username, req.user.id))) {
        return res.status(409).json({ error: 'That username is taken.' });
      }
      await pool.query(
        'UPDATE users SET name = $1, username = $2, display_preference = $3, updated_at = NOW() WHERE id = $4',
        [profile.name, profile.username, profile.displayPreference, req.user.id]
      );
      res.json({ success: true });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That username is taken.' });
      logger.error(`Profile update for user ${req.user.id} failed: ${err.code || err.name}`);
      res.status(500).json({ error: 'Could not save your profile. Please try again.' });
    }
  });

  // One-time step for accounts created without the sign-up form (a first
  // Google sign-in, or a first emailed code).
  router.post('/complete-signup', isAuthenticated, express.json(), async (req, res) => {
    const { profile, error } = parseProfile(req.body);
    if (error) return res.status(400).json({ error });
    const consents = consentsFrom(req.body);
    if (!consents.ageConfirmed || !consents.termsAccepted) {
      return res.status(400).json({ error: CONSENT_REQUIRED });
    }
    try {
      if (profile.username && !(await usernameAvailable(pool, profile.username, req.user.id))) {
        return res.status(409).json({ error: 'That username is taken.' });
      }
      const updated = await pool.query(
        `UPDATE users SET name = $1, username = $2, display_preference = $3,
           terms_accepted_at = NOW(), age_confirmed_at = NOW(), newsletter_opt_in = $4,
           signup_completed_at = COALESCE(signup_completed_at, NOW()), updated_at = NOW()
         WHERE id = $5 RETURNING *`,
        [profile.name, profile.username, profile.displayPreference, consents.newsletter, req.user.id]
      );
      await releaseNewsletterOptIn(pool, updated.rows[0]);
      res.json({ success: true });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That username is taken.' });
      logger.error(`Finishing sign-up for user ${req.user.id} failed: ${err.code || err.name}`);
      res.status(500).json({ error: 'Could not save your details. Please try again.' });
    }
  });

  router.post('/confirm-email/resend',
    isAuthenticated,
    limiter(60 * 60 * 1000, 3, userKey),
    async (req, res) => {
      if (req.user.email_verified_at) return res.status(400).json({ error: 'Your email is already confirmed.' });
      if (!mailer.enabled) return res.status(501).json({ error: 'Email is not available right now.' });
      try {
        await requestLogin(pool, mailer, req.user.email, frontendUrl, { purpose: 'confirm' });
        res.json({ success: true, message: `We sent a new confirmation email to ${req.user.email}.` });
      } catch (err) {
        logger.error(`Confirmation resend failed: ${err.code || err.name}`);
        res.status(502).json({ error: "We couldn't send the email. Please try again in a few minutes." });
      }
    });
}
