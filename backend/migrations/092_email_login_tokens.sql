-- Migration 092: Passwordless email sign-in (spec 045)
-- One row per "email me a sign-in link" request. Only SHA-256 hashes of the
-- link token and the 6-digit code are stored; the raw values exist only in
-- the email. Rows are single-use (consumed_at) and short-lived (expires_at).
-- Idempotent: runs on every boot.

CREATE TABLE IF NOT EXISTS email_login_tokens (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_login_tokens_email_created
  ON email_login_tokens (email, created_at DESC);

-- Privacy policy: say what email sign-in collects. No-op once applied or if an
-- admin has reworded the line.
-- Fix: the replacement contains the text it replaces, so without a guard every
-- boot added the sentence again (migration 094 rewrites it, hence the second
-- pattern). Migration 102 removes the copies already made.
UPDATE admin_settings
SET value = replace(
  value,
  'When you sign in with Google or Facebook, we receive:',
  'When you sign in with a link we email you, we only receive your email address. When you sign in with Google or Facebook, we receive:'
)
WHERE key = 'about_privacy_md'
  AND value NOT LIKE '%When you sign in with a link we email you%'
  AND value NOT LIKE '%to reset your password%';
