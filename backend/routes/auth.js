import express from 'express';
import passport from 'passport';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

// Google OAuth - single flow for all users
// Admins get drive.file scope and credentials stored in database
// accessType: 'offline' requests a refresh token
// prompt: 'consent' forces consent screen to ensure we get refresh token
router.get('/google', passport.authenticate('google', {
  accessType: 'offline',
  prompt: 'consent'
}));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}?auth=failed` }),
  (req, res) => {
    // Always redirect to View tab (default) after login
    res.redirect(`${FRONTEND_URL}?auth=success`);
  }
);

// Facebook OAuth
router.get('/facebook', passport.authenticate('facebook', {
  scope: ['email']
}));

router.get('/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: `${FRONTEND_URL}?auth=failed` }),
  (req, res) => {
    res.redirect(`${FRONTEND_URL}?auth=success`);
  }
);

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
