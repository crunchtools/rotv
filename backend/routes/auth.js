import express from 'express';
import passport from 'passport';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'scott.mccarty@gmail.com';

// Google OAuth - dual-strategy approach for conditional Drive access
// Standard route: all users authenticate with basic scopes (profile + email)
// Upgrade route: admin-only Drive scope via incremental authorization
// Auto-detection: admin users without Drive credentials are redirected to upgrade flow
// Fix: Only register routes if strategy is configured (prevents "Unknown strategy" error)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  // Standard Google OAuth (all users - basic scopes only)
  router.get('/google', passport.authenticate('google'));

  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}?auth=failed` }),
    async (req, res) => {
      // Auto-detect admin without Drive credentials
      const isAdmin = req.user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      const hasCredentials = req.user.oauth_credentials &&
                            JSON.parse(req.user.oauth_credentials).access_token;

      if (isAdmin && !hasCredentials) {
        // Redirect admin to upgrade flow for Drive access
        return res.redirect('/auth/google/upgrade');
      }

      // Standard success redirect
      res.redirect(`${FRONTEND_URL}?auth=success`);
    }
  );

  // Drive scope upgrade (admin only - incremental authorization)
  router.get('/google/upgrade', passport.authenticate('google-upgrade', {
    accessType: 'offline',
    prompt: 'consent'
  }));

  router.get('/google/upgrade/callback',
    passport.authenticate('google-upgrade', { failureRedirect: `${FRONTEND_URL}?auth=failed` }),
    (req, res) => {
      // Redirect to Sync Settings after Drive access granted
      res.redirect(`${FRONTEND_URL}/admin?auth=success&tab=sync`);
    }
  );
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
