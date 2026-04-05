import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';

export function configurePassport(pool) {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'scott.mccarty@gmail.com';

  // Serialize just the user ID to session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session - load credentials from database
  passport.deserializeUser(async (sessionData, done) => {
    try {
      // Handle both old format (object with id) and new format (just id)
      const userId = typeof sessionData === 'object' ? sessionData.id : sessionData;

      const userQuery = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (userQuery.rows.length === 0) {
        return done(null, false);
      }
      done(null, userQuery.rows[0]);
    } catch (error) {
      done(error);
    }
  });

  // Find or create user in database, store credentials for admins
  async function findOrCreateUser(provider, profile, credentials) {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName;
    const pictureUrl = profile.photos?.[0]?.value;
    const providerId = profile.id;
    const isAdmin = email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

    // Check if user exists
    let userLookup = await pool.query(
      'SELECT * FROM users WHERE oauth_provider = $1 AND oauth_provider_id = $2',
      [provider, providerId]
    );

    if (userLookup.rows.length > 0) {
      // Update existing user - always update credentials for admins
      const updateFields = ['last_login_at = CURRENT_TIMESTAMP', 'picture_url = $1', 'name = $2'];
      const updateValues = [pictureUrl, name];

      // Sync is_admin and role on login (only promote to admin, never demote via login)
      if (isAdmin && !userLookup.rows[0].is_admin) {
        updateFields.push(`is_admin = $${updateValues.length + 1}`);
        updateValues.push(true);
        updateFields.push(`role = $${updateValues.length + 1}`);
        updateValues.push('admin');
      }

      if (isAdmin && credentials) {
        updateFields.push(`oauth_credentials = $${updateValues.length + 1}`);
        updateValues.push(JSON.stringify(credentials));
      }

      updateValues.push(userLookup.rows[0].id);

      await pool.query(
        `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${updateValues.length}`,
        updateValues
      );

      userLookup = await pool.query('SELECT * FROM users WHERE id = $1', [userLookup.rows[0].id]);
      return userLookup.rows[0];
    }

    // Create new user
    const role = isAdmin ? 'admin' : 'viewer';
    const insertResult = await pool.query(
      `INSERT INTO users (email, name, picture_url, oauth_provider, oauth_provider_id, is_admin, role, oauth_credentials, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING *`,
      [email, name, pictureUrl, provider, providerId, isAdmin, role, isAdmin && credentials ? JSON.stringify(credentials) : null]
    );

    return insertResult.rows[0];
  }

  // Google OAuth Strategy (dual-strategy approach for conditional Drive access)
  // Standard strategy - all users get basic profile + email scopes only
  // Admin users are auto-redirected to upgrade flow if they lack Drive credentials
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    // Standard strategy - basic scopes for all users (no Drive access)
    passport.use('google', new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      scope: ['profile', 'email']
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        // Don't store credentials for standard login (admin will get them via upgrade flow)
        const user = await findOrCreateUser('google', profile, null);
        done(null, user);
      } catch (error) {
        done(error);
      }
    }));

    // Upgrade strategy - Drive scope for admin only (incremental authorization)
    passport.use('google-upgrade', new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/upgrade/callback',
      scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file']
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        // Store Drive credentials for admin
        const credentials = {
          access_token: accessToken,
          refresh_token: refreshToken
        };
        const user = await findOrCreateUser('google', profile, credentials);
        done(null, user);
      } catch (error) {
        done(error);
      }
    }));

    console.log('Google OAuth strategies configured (standard + upgrade)');
  } else {
    console.log('Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)');
  }

  // Facebook OAuth Strategy
  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: process.env.FACEBOOK_CALLBACK_URL || '/auth/facebook/callback',
      profileFields: ['id', 'displayName', 'photos', 'email']
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateUser('facebook', profile, null);
        done(null, user);
      } catch (error) {
        done(error);
      }
    }));
    console.log('Facebook OAuth strategy configured');
  } else {
    console.log('Facebook OAuth not configured (missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET)');
  }

  return passport;
}
