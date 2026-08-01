import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { findOrCreateUser as resolveUserAccount } from './userAccount.js';

export function configurePassport(pool) {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'scott.mccarty@gmail.com';

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (sessionData, done) => {
    try {
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

  const findOrCreateUser = (provider, profile, credentials) =>
    resolveUserAccount(pool, ADMIN_EMAIL, provider, profile, credentials);

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use('google', new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      scope: ['profile', 'email']
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateUser('google', profile, null);
        done(null, user);
      } catch (error) {
        done(error);
      }
    }));

    passport.use('google-upgrade', new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file']
    }, async (accessToken, refreshToken, profile, done) => {
      try {
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
