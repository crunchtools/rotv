import express from 'express';
import passport from 'passport';
import { createLogger } from '../utils/logger.js';
import { isAuthenticated } from '../middleware/auth.js';
import { deleteUserAccount } from '../services/accountDeletion.js';
import { findOrCreateUser, adminEmail } from '../config/userAccount.js';
import { createMailer } from '../services/mailer.js';
import { normalizeEmail, requestLogin, verifyToken, verifyCode } from '../services/emailLogin.js';
import { limiter, ipKey, emailKey, completeLogin, stampLogin } from '../utils/authSession.js';
import { addAccountRoutes } from './authAccounts.js';
import { displayNameOf } from '../services/accountProfile.js';
import { releaseNewsletterOptIn } from '../services/signupNewsletter.js';

const logger = createLogger('Auth');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// Where an OAuth sign-in lands: accounts made without the sign-up form finish
// it on /welcome first (spec 046).
function afterOAuth(user) {
  return user.signup_completed_at ? `${FRONTEND_URL}?auth=success` : `${FRONTEND_URL}/welcome?auth=success`;
}

const EMAIL_START_SENT = 'If that address can receive mail, a sign-in link and code are on the way.';
const EMAIL_VERIFY_FAILED = 'That link or code is invalid or has expired. Request a new one to try again.';

/**
 * Build the /auth router: Google, Facebook and email sign-in, session status,
 * logout and account deletion.
 * @param {import('pg').Pool} pool
 * @param {{mailer?: {enabled: boolean, send: (msg: {to: string, subject: string, text: string, html: string}) => Promise<string>}}} [options]
 *   mailer override for tests; defaults to createMailer() from the environment
 * @returns {import('express').Router}
 */
export function createAuthRouter(pool, { mailer = createMailer() } = {}) {
  const router = express.Router();

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    router.get('/google', passport.authenticate('google'));

    router.get('/google/upgrade', passport.authenticate('google-upgrade', {
      accessType: 'offline',
      prompt: 'consent',
      state: 'upgrade'
    }));

    router.get('/google/callback', (req, res, next) => {
      const isUpgrade = req.query.state === 'upgrade';
      const strategy = isUpgrade ? 'google-upgrade' : 'google';

      passport.authenticate(strategy, {
        failureRedirect: `${FRONTEND_URL}?auth=failed`
      })(req, res, async () => {
        stampLogin(req, req.user);
        if (isUpgrade) {
          return res.redirect(`${FRONTEND_URL}/admin?auth=success&tab=sync`);
        }

        const isAdmin = req.user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

        let credentials = null;
        if (req.user.oauth_credentials) {
          try {
            credentials = typeof req.user.oauth_credentials === 'string'
              ? JSON.parse(req.user.oauth_credentials)
              : req.user.oauth_credentials;
          } catch (err) {
            logger.error('Failed to parse oauth_credentials:', err);
            credentials = null;
          }
        }
        const hasCredentials = credentials && credentials.access_token;

        if (isAdmin && !hasCredentials) {
          return res.redirect('/auth/google/upgrade');
        }

        res.redirect(afterOAuth(req.user));
      });
    });
  } else {
    router.get('/google', (req, res) => {
      res.status(501).json({ error: 'Google OAuth not configured. Contact administrator.' });
    });
    router.get('/google/callback', (req, res) => {
      res.status(501).json({ error: 'Google OAuth not configured. Contact administrator.' });
    });
  }

  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    router.get('/facebook', passport.authenticate('facebook', {
      scope: ['email']
    }));

    router.get('/facebook/callback',
      passport.authenticate('facebook', { failureRedirect: `${FRONTEND_URL}?auth=failed` }),
      (req, res) => {
        stampLogin(req, req.user);
        res.redirect(afterOAuth(req.user));
      }
    );
  } else {
    router.get('/facebook', (req, res) => {
      res.status(501).json({ error: 'Facebook OAuth not configured. Contact administrator.' });
    });
    router.get('/facebook/callback', (req, res) => {
      res.status(501).json({ error: 'Facebook OAuth not configured. Contact administrator.' });
    });
  }

  // Which sign-in providers the UI should offer, so it never shows a button
  // that would land on the 501 below. Facebook also waits for
  // FACEBOOK_LOGIN_LIVE=true: while the Meta app is unpublished, only accounts
  // with a role on it can sign in, so /auth/facebook works for testing and
  // App Review but the public button stays hidden.
  router.get('/providers', (req, res) => {
    res.json({
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      facebook: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) &&
        process.env.FACEBOOK_LOGIN_LIVE === 'true',
      email: Boolean(mailer.enabled),
      password: true,
      passkey: true
    });
  });

  // Self-service account deletion (#700). Admins are refused: the admin
  // account is re-created with admin rights on the next sign-in anyway, and
  // losing it by accident would orphan the site's settings audit trail.
  router.delete('/account', isAuthenticated, async (req, res) => {
    if (req.user.is_admin || req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot be deleted from the interface.' });
    }
    try {
      await deleteUserAccount(pool, req.user.id);
    } catch (err) {
      logger.error(`Account deletion failed for user ${req.user.id}:`, err);
      return res.status(500).json({ error: 'Account deletion failed. Nothing was deleted; please try again.' });
    }
    // The account is already gone, so cleanup failures are logged but still
    // reported as success: the stale session no longer resolves to a user.
    req.logout((logoutErr) => {
      if (logoutErr) logger.error(`Logout after deleting user ${req.user?.id} failed:`, logoutErr);
      req.session.destroy((destroyErr) => {
        if (destroyErr) logger.error('Session destroy after account deletion failed:', destroyErr);
        res.clearCookie('connect.sid');
        res.json({ success: true });
      });
    });
  });

  // Passwordless email sign-in (spec 045). start always answers the same way so
  // it never reveals whether an address has an account.
  router.post('/email/start',
    express.json(),
    limiter(60 * 60 * 1000, 5, ipKey),
    limiter(15 * 60 * 1000, 3, emailKey),
    limiter(24 * 60 * 60 * 1000, 10, emailKey),
    async (req, res) => {
      if (!mailer.enabled) {
        return res.status(501).json({ error: 'Email sign-in is not available.' });
      }
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        return res.status(400).json({ error: 'Enter a valid email address.' });
      }
      try {
        // Fix: never build the link from the Host header, or a forged Host could
        // send a victim's token to an attacker's site (PR review). FRONTEND_URL is
        // the configured origin the OAuth redirects already use.
        await requestLogin(pool, mailer, email, FRONTEND_URL);
      } catch (err) {
        // Error text (SMTP replies, constraint details) can quote the address,
        // so the email sign-in handlers log only error codes.
        logger.error(`Email sign-in request failed: ${err.code || err.name} ${err.responseCode || ''} ${err.command || ''}`.trim());
        return res.status(502).json({ error: "We couldn't send the email. Please try again in a few minutes." });
      }
      res.json({ success: true, message: EMAIL_START_SENT });
    });

  // "I didn't create this account" on a sign-up confirmation link (spec 046):
  // the address owner removes an unconfirmed account someone else made with
  // their email, along with any password or passkey on it.
  router.post('/email/reject',
    express.json(),
    limiter(15 * 60 * 1000, 30, ipKey),
    async (req, res) => {
      try {
        const verified = await verifyToken(pool, String(req.body?.token || ''));
        if (!verified || verified.purpose !== 'confirm') {
          return res.status(400).json({ error: EMAIL_VERIFY_FAILED });
        }
        const unconfirmed = await pool.query(
          'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND email_verified_at IS NULL',
          [verified.email]
        );
        // Rechecked under the row lock: an account confirmed meanwhile is kept.
        let removed = 0;
        for (const { id } of unconfirmed.rows) {
          if (await deleteUserAccount(pool, id, { unconfirmedForDays: 0 })) removed += 1;
        }
        if (!removed) {
          // Fix: don't claim a removal that didn't happen (PR #714 review).
          return res.status(409).json({
            error: 'This account was already confirmed, so it was not removed. If you didn’t create it, sign in with an emailed code: that removes any password or passkey someone else set.'
          });
        }
        res.json({ success: true });
      } catch (err) {
        logger.error(`Rejecting a sign-up failed: ${err.code || err.name}`);
        res.status(500).json({ error: 'Something went wrong. Please try again.' });
      }
    });

  router.post('/email/verify',
    express.json(),
    limiter(15 * 60 * 1000, 30, ipKey),
    async (req, res) => {
      const { token, code } = req.body || {};
      let verified;
      try {
        verified = token
          ? await verifyToken(pool, String(token))
          : await verifyCode(pool, normalizeEmail(req.body?.email), String(code || ''));
      } catch (err) {
        logger.error(`Email sign-in verification failed: ${err.code || err.name}`);
        return res.status(500).json({ error: 'Sign-in failed. Please try again.' });
      }
      if (!verified) {
        return res.status(400).json({ error: EMAIL_VERIFY_FAILED });
      }
      const { email, purpose } = verified;
      try {
        const confirmsSignup = purpose === 'confirm';
        const user = await findOrCreateUser(pool, adminEmail(), 'email', { id: email, emails: [{ value: email }] }, null, { confirmsSignup });
        await completeLogin(req, user);
        if (confirmsSignup) await releaseNewsletterOptIn(pool, user);
        res.json({ success: true, confirmed: confirmsSignup, needsSignupCompletion: !user.signup_completed_at });
      } catch (err) {
        logger.error(`Account lookup or session login after email verification failed: ${err.code || err.name}`);
        res.status(500).json({ error: 'Sign-in failed. Please try again.' });
      }
    });

  addAccountRoutes(router, pool, { mailer, frontendUrl: FRONTEND_URL });

  router.get('/user', async (req, res) => {
    if (process.env.NODE_ENV === 'test' && process.env.BYPASS_AUTH === 'true') {
      return res.json({
        id: 999,
        email: 'test-admin@rotv.local',
        name: 'Test Admin',
        username: null,
        displayPreference: 'name',
        displayName: 'Test Admin',
        emailVerified: true,
        needsSignupCompletion: false,
        notice: null,
        pictureUrl: null,
        isAdmin: true,
        role: 'admin',
        favorites: [],
        visited: [],
        preferences: {}
      });
    }

    if (req.isAuthenticated()) {
      const { id, email, name, username, display_preference, picture_url, is_admin, role, preferences } = req.user;
      let favorites;
      try {
        const favResult = await pool.query(
          `SELECT poi_id FROM user_poi_favorites WHERE user_id = $1 ORDER BY created_at DESC`,
          [id]
        );
        favorites = favResult.rows.map(r => r.poi_id);
      } catch (err) {
        logger.error('Failed to load favorites for /auth/user, returning none:', err);
        favorites = [];
      }
      let visited;
      try {
        const visitedResult = await pool.query(
          `SELECT poi_id FROM user_visits WHERE user_id = $1 ORDER BY visited_at DESC`,
          [id]
        );
        visited = visitedResult.rows.map(r => r.poi_id);
      } catch (err) {
        logger.error('Failed to load visited for /auth/user, returning none:', err);
        visited = [];
      }
      // Shown once: tells the person why their earlier sign-in methods are gone.
      const notice = req.session.authNotice || null;
      delete req.session.authNotice;
      res.json({
        id,
        email,
        name,
        username: username || null,
        displayPreference: display_preference || 'name',
        displayName: displayNameOf(req.user),
        emailVerified: Boolean(req.user.email_verified_at),
        needsSignupCompletion: !req.user.signup_completed_at,
        notice,
        pictureUrl: picture_url,
        isAdmin: is_admin,
        role: role || 'viewer',
        favorites,
        visited,
        preferences: preferences || {}
      });
    } else {
      res.json(null);
    }
  });

  router.post('/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: 'Logout failed' });
      }
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ error: 'Session destruction failed' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
      });
    });
  });

  router.get('/status', (req, res) => {
    if (process.env.NODE_ENV === 'test' && process.env.BYPASS_AUTH === 'true') {
      return res.json({
        authenticated: true,
        isAdmin: true,
        role: 'admin'
      });
    }

    res.json({
      authenticated: req.isAuthenticated(),
      isAdmin: req.user?.is_admin || false,
      role: req.user?.role || 'viewer'
    });
  });

  return router;
}
