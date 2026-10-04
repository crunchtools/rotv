-- Migration 093: Sign-up, passwords and passkeys (spec 046)
-- Profile and confirmation columns on users, password and passkey tables
-- (separate from users so `SELECT * FROM users` never carries a secret), a
-- purpose for email tokens (sign-in vs. email confirmation), the Terms of Use
-- page, and the privacy-policy line about what sign-up stores.
-- Idempotent: runs on every boot. The backfill runs only in the boot that adds
-- the columns, so accounts created later are never marked confirmed by it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'signup_completed_at'
  ) THEN
    ALTER TABLE users
      ADD COLUMN username VARCHAR(30),
      ADD COLUMN display_preference VARCHAR(10) NOT NULL DEFAULT 'name',
      ADD COLUMN email_verified_at TIMESTAMPTZ,
      ADD COLUMN terms_accepted_at TIMESTAMPTZ,
      ADD COLUMN age_confirmed_at TIMESTAMPTZ,
      ADD COLUMN newsletter_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN signup_completed_at TIMESTAMPTZ;

    -- Every existing account signed in through Google or an emailed code, so
    -- its address is already proven. They are grandfathered past sign-up.
    UPDATE users
    SET email_verified_at = COALESCE(created_at, NOW()),
        signup_completed_at = COALESCE(created_at, NOW());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_display_preference_check' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_display_preference_check
      CHECK (display_preference IN ('name', 'username'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

-- Sign-in and account linking look accounts up by LOWER(email), so emails are
-- unique ignoring case. Production had no case-only duplicates when this was
-- written (checked 2026-10-03), and every insert path checks LOWER(email)
-- first. If duplicates ever existed this would fail loudly rather than leave
-- sign-in matching an arbitrary account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

-- Revoking an account's sessions (takeover, deletion) filters on the
-- passport user inside the session JSON. The sessions table is created by
-- connect-pg-simple on first start, so it may not exist yet on a fresh boot.
DO $$
BEGIN
  IF to_regclass('sessions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_sessions_passport_user ON sessions ((sess -> 'passport' ->> 'user'));
  END IF;
END $$;

-- Finds accounts left unconfirmed for the 30-day cleanup job.
CREATE INDEX IF NOT EXISTS idx_users_unconfirmed
  ON users (created_at) WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS user_passwords (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_passkeys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  device_type VARCHAR(20),
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  name VARCHAR(60) NOT NULL DEFAULT 'Passkey',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys (user_id);

-- 'login' rows sign someone in (admin-set lifetime); 'confirm' rows confirm a
-- new account's email (7 days) and also sign the person in.
ALTER TABLE email_login_tokens ADD COLUMN IF NOT EXISTS purpose VARCHAR(10) NOT NULL DEFAULT 'login';

-- Terms of Use page (/terms), admin-editable. Never overwrites admin edits.
INSERT INTO admin_settings (key, value) VALUES ('about_terms_md', '# Terms of Use

Last updated: October 3, 2026

Roots of the Valley is a free community map and guide to the Cuyahoga Valley in Ohio, run by Scott McCarty. By using the site, you agree to these terms of use. We wrote them in plain English, and kept them short and readable.

## What Roots of the Valley is

Roots of the Valley is a free community project designed to help you explore the Cuyahoga Valley. The site brings together trail maps, points of interest, local history, area news and events, live trackers for the train and water taxi, trail status, and river levels, and everything is free to access.

## Your account

You do not need an account to explore maps or read guides. If you want to save your progress, you can create an account using Google, or by using your email address with a password or passkey. You can also sign in through your email using a one-time link or code. You must be 13 or older to create an account.

When you create an account, we store your name, an optional username, your choice for how you want to appear (your name or your username), your email address, your saved favorites, visited places, saved trips, and your site preferences. Please keep your sign-in details secure, and never use someone else''s account. If an account is created and the email address is never confirmed, we delete it automatically after 30 days.

## Deleting your account

You are in control of your account, and you can delete it at any time in your account Settings. For more information on that process, read our page on [data deletion](/data-deletion). When you delete your account, any content you contributed remains online under the terms described below.

## Your privacy

You can find all the details about what information we collect and how it gets used in our [Privacy Policy](/privacy).

## Content you contribute

Some authorized users, such as site administrators and approved contributors, can submit content, including photos and other media. If you upload anything, you must have the legal right to share that material. By uploading content, you grant Roots of the Valley a license to display your contributions. If you delete your account, those materials stay online to preserve community history, but we detach them from your account.

## Using the site responsibly

We built this resource for everyone who loves the valley, so we expect visitors to treat the site and each other with common sense. When using the site, you agree not to:

- Run automated scraping that burdens or slows down the service.
- Attempt to break or bypass the security of the site.
- Impersonate any person or group.
- Post or transmit unlawful content.
- Use an account or email address that belongs to someone else.

## Information is provided as-is

All information on Roots of the Valley is provided as-is. Much of our data, including live train and water taxi trackers, trail conditions, river levels, schedules and events, comes from third parties. That data can be delayed or plain wrong, and river conditions or trail washouts can change much faster than website updates.

Outdoor recreation carries real risks, and you head outdoors at your own risk. I think of this map as a handy digital helper in your pocket, but it is never a substitute for your own eyes and current trail reports. Always check official sources, such as the National Park Service, before heading out into the park or stepping onto the river.

## Newsletter

We publish a weekly Friday email newsletter through Buttondown. Subscribing is optional, and you can unsubscribe at any time.

## Changes and suspension

We may update these terms as we add new features. If you continue using the site after we publish changes, that means you accept the updated terms. We may suspend accounts that abuse the service.

## Governing law and contact

These terms are governed by the laws of Ohio in the United States. If you have questions about these terms, please contact us at [admin@rootsofthevalley.org](mailto:admin@rootsofthevalley.org).')
ON CONFLICT (key) DO NOTHING;

-- Privacy policy: say what sign-up stores. No-op once applied or if an admin
-- has reworded the line.
UPDATE admin_settings
SET value = replace(
  value,
  'When you sign in with a link we email you, we only receive your email address.',
  'When you create an account with email, we store your name, the username you choose (if any), your email address, and either a password (only as a salted scrypt hash, never the password itself) or a passkey (only its public key). When you sign in with a link we email you, we only receive your email address.'
)
WHERE key = 'about_privacy_md'
  AND value NOT LIKE '%salted scrypt hash%';
