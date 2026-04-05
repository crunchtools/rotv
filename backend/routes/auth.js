import express from 'express';
import passport from 'passport';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// Google OAuth - dual-strategy approach for conditional Drive access
// Standard route: all users authenticate with basic scopes (profile + email)
// Upgrade route: admin-only Drive scope via incremental authorization
// Auto-detection: admin users without Drive credentials are redirected to upgrade flow
// Fix: Only register routes if strategy is configured (prevents "Unknown strategy" error)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  // Standard Google OAuth (all users - basic scopes only)
  router.get('/google', passport.authenticate('google'));

  // Drive scope upgrade (admin only - incremental authorization)
  router.get('/google/upgrade', passport.authenticate('google-upgrade', {
    accessType: 'offline',
    prompt: 'consent',
    state: 'upgrade' // Pass state to identify upgrade flow in callback
  }));

  // Unified callback handler - handles both standard and upgrade flows
  router.get('/google/callback', (req, res, next) => {
    // Check if this is an upgrade callback (state=upgrade)
    const isUpgrade = req.query.state === 'upgrade';
    const strategy = isUpgrade ? 'google-upgrade' : 'google';

    passport.authenticate(strategy, {
      failureRedirect: `${FRONTEND_URL}?auth=failed`
    })(req, res, async () => {
      // Handle upgrade flow - redirect to Sync Settings
      if (isUpgrade) {
        return res.redirect(`${FRONTEND_URL}/admin?auth=success&tab=sync`);
      }

      // Handle standard flow - auto-detect admin without Drive credentials
      const isAdmin = req.user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

      // Parse credentials (handles both JSON string and object from pg driver)
      let credentials = null;
      if (req.user.oauth_credentials) {
        try {
          credentials = typeof req.user.oauth_credentials === 'string'
            ? JSON.parse(req.user.oauth_credentials)
            : req.user.oauth_credentials;
        } catch (err) {
          console.error('Failed to parse oauth_credentials:', err);
          credentials = null;
        }
      }
      const hasCredentials = credentials && credentials.access_token;

      if (isAdmin && !hasCredentials) {
        // Redirect admin to upgrade flow for Drive access
        return res.redirect('/auth/google/upgrade');
      }

      // Standard success redirect
      res.redirect(`${FRONTEND_URL}?auth=success`);
    });
  });
} else {
  // Return helpful error when OAuth not configured
  router.get('/google', (req, res) => {
    res.status(501).json({ error: 'Google OAuth not configured. Contact administrator.' });
  });
  router.get('/google/callback', (req, res) => {
    res.status(501).json({ error: 'Google OAuth not configured. Contact administrator.' });
  });
}

// Facebook OAuth
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  router.get('/facebook', passport.authenticate('facebook', {
    scope: ['email']
  }));

  router.get('/facebook/callback',
    passport.authenticate('facebook', { failureRedirect: `${FRONTEND_URL}?auth=failed` }),
    (req, res) => {
      res.redirect(`${FRONTEND_URL}?auth=success`);
    }
  );
} else {
  // Return helpful error when OAuth not configured
  router.get('/facebook', (req, res) => {
    res.status(501).json({ error: 'Facebook OAuth not configured. Contact administrator.' });
  });
  router.get('/facebook/callback', (req, res) => {
    res.status(501).json({ error: 'Facebook OAuth not configured. Contact administrator.' });
  });
}

// Get current user
router.get('/user', (req, res) => {
  if (req.isAuthenticated()) {
    // Return user info without sensitive data (no oauth_credentials)
    const { id, email, name, picture_url, is_admin, role, favorite_destinations, preferences } = req.user;
    res.json({
      id,
      email,
      name,
      pictureUrl: picture_url,
      isAdmin: is_admin,
      role: role || 'viewer',
      favorites: favorite_destinations || [],
      preferences: preferences || {}
    });
  } else {
    res.json(null);
  }
});

// Logout
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

// Check auth status (lightweight)
router.get('/status', (req, res) => {
  res.json({
    authenticated: req.isAuthenticated(),
    isAdmin: req.user?.is_admin || false,
    role: req.user?.role || 'viewer'
  });
});

export default router;
