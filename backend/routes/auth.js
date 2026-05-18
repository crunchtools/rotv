import express from 'express';
import passport from 'passport';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

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
          console.error('Failed to parse oauth_credentials:', err);
          credentials = null;
        }
      }
      const hasCredentials = credentials && credentials.access_token;

      if (isAdmin && !hasCredentials) {
        return res.redirect('/auth/google/upgrade');
      }

      res.redirect(`${FRONTEND_URL}?auth=success`);
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
      res.redirect(`${FRONTEND_URL}?auth=success`);
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

router.get('/user', (req, res) => {
  if (process.env.NODE_ENV === 'test' && process.env.BYPASS_AUTH === 'true') {
    return res.json({
      id: 999,
      email: 'test-admin@rotv.local',
      name: 'Test Admin',
      pictureUrl: null,
      isAdmin: true,
      role: 'admin',
      favorites: [],
      preferences: {}
    });
  }

  if (req.isAuthenticated()) {
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

export default router;
