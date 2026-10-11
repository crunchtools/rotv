import express from 'express';
import passport from 'passport';
import { createLogger } from '../utils/logger.js';
import { isAuthenticated } from '../middleware/auth.js';
import { deleteUserAccount } from '../services/accountDeletion.js';
import { createMailer } from '../services/mailer.js';
import { consumeToken, usedTokenEmail } from '../services/emailLogin.js';
import { limiter, ipKey, stampLogin } from '../utils/authSession.js';
import { addAccountRoutes } from './authAccounts.js';
import { displayNameOf } from '../services/accountProfile.js';
import { releaseNewsletterOptIn } from '../services/signupNewsletter.js';
import { getUserCheckins } from '../services/poiListService.js';

const logger = createLogger('Auth');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// Where an OAuth sign-in lands: accounts made without the sign-up form finish
// it on /welcome first (spec 046).
function afterOAuth(user) {
  return user.signup_completed_at ? `${FRONTEND_URL}?auth=success` : `${FRONTEND_URL}/welcome?auth=success`;
}

const CONFIRM_FAILED = 'That confirmation link has expired. Sign in and choose “Resend confirmation email” in Settings.';

/**
 * Build the /auth router: Google and Facebook sign-in, email confirmation, session status,
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
        stampLogin(req);
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
        stampLogin(req);
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
      password: true,
      passkey: true,
      passwordReset: Boolean(mailer.enabled)
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

  // The link in a sign-up's confirmation email (spec 046). It only confirms
  // the address; it never signs anyone in, so a mail scanner that opens it
  // first gets nothing but a confirmed address. The account's own password or
  // passkey is kept, and the account must still exist.
  router.post('/email/verify',
    express.json(),
    limiter(15 * 60 * 1000, 30, ipKey),
    async (req, res) => {
      try {
        const token = String(req.body?.token || '');
        const email = await consumeToken(pool, token, 'confirm');
        if (!email) {
          // Fix: a link opened before (often by a mail scanner) on an account
          // that is now confirmed says so instead of erroring (PR #716 review).
          const usedFor = await usedTokenEmail(pool, token, 'confirm');
          const confirmed = usedFor && await pool.query(
            'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND email_verified_at IS NOT NULL', [usedFor]);
          if (confirmed?.rows.length) {
            // Retries a newsletter hand-off that failed the first time.
            await releaseNewsletterOptIn(pool, confirmed.rows[0]);
            return res.json({ success: true });
          }
          return res.status(400).json({ error: CONFIRM_FAILED });
        }
        const updated = await pool.query(
          `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
           WHERE LOWER(email) = LOWER($1) RETURNING *`,
          [email]
        );
        if (!updated.rows.length) return res.status(400).json({ error: CONFIRM_FAILED });
        await releaseNewsletterOptIn(pool, updated.rows[0]);
        res.json({ success: true });
      } catch (err) {
        logger.error(`Email confirmation failed: ${err.code || err.name}`);
        res.status(500).json({ error: 'Something went wrong. Please try again.' });
      }
    });

  addAccountRoutes(router, pool, { mailer, frontendUrl: FRONTEND_URL });

  // The rest of /auth/user must still load when the check-ins cannot be read.
  const loadListCheckins = async (userId) => {
    try {
      return await getUserCheckins(pool, userId);
    } catch (err) {
      logger.error('Failed to load list check-ins for /auth/user, returning none:', err);
      return [];
    }
  };

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
        pictureUrl: null,
        isAdmin: true,
        role: 'admin',
        favorites: [],
        visited: [],
        // Read for real, so a check-in made in the hosted dev container survives a reload.
        listCheckins: await loadListCheckins(999),
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
      const listCheckins = await loadListCheckins(id);
      res.json({
        id,
        email,
        name,
        username: username || null,
        displayPreference: display_preference || 'name',
        displayName: displayNameOf(req.user),
        emailVerified: Boolean(req.user.email_verified_at),
        needsSignupCompletion: !req.user.signup_completed_at,
        pictureUrl: picture_url,
        isAdmin: is_admin,
        role: role || 'viewer',
        favorites,
        visited,
        listCheckins,
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
