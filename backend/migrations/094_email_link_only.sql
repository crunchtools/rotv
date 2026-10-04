-- Migration 094: Account emails are links only (v1.52.0)
-- Email no longer signs anyone in with a code; it only confirms a new
-- account's address or resets a password, each with a single link. New rows
-- have no code digest. The unused `attempts` column is left in place.
-- Idempotent: runs on every boot.

ALTER TABLE email_login_tokens ALTER COLUMN code_hash DROP NOT NULL;

-- Privacy policy: email links are for confirming and resetting, not signing in.
-- No-op once applied or if an admin has reworded the line.
UPDATE admin_settings
SET value = replace(
  value,
  'When you sign in with a link we email you, we only receive your email address.',
  'We only email you to confirm your address or, if you ask, to reset your password.'
)
WHERE key = 'about_privacy_md';
