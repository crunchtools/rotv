-- Migration: 088_user_identities
-- Description: Let one account carry several OAuth logins so a user can sign in with
-- either Google or Facebook on the same email. `users.email` is UNIQUE, so the old
-- "look up by (oauth_provider, oauth_provider_id), otherwise INSERT" path raised a
-- constraint violation the first time an existing user arrived via a second provider —
-- which is what blocked Facebook login entirely.
--
-- `users.oauth_provider` / `oauth_provider_id` are deliberately left in place. They no
-- longer act as the lookup key, but the admin user list still reports them as the
-- provider the account was created with.
--
-- initDatabase() in server.js performs the same work on every boot, so production
-- self-heals on deploy; this file keeps the documented migration path complete.

CREATE TABLE IF NOT EXISTS user_identities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);

INSERT INTO user_identities (user_id, provider, provider_id, created_at)
SELECT id, oauth_provider, oauth_provider_id, created_at FROM users
ON CONFLICT (provider, provider_id) DO NOTHING;
