-- Migration: 102_contact_details_privacy.sql
-- Description: Say in the privacy policy, the data deletion page and the terms
--   that an account can now hold seasonal challenge hikes and, if the person
--   adds them, contact details for filling in forms (#711, spec 050). Also
--   removes a sentence migration 092 had been repeating in the privacy policy.
-- Idempotent: these pages are admin-editable, so each change is a replace() of
--   one known line, guarded by the new wording. It is a no-op once applied, and
--   where an admin has already reworded the line it leaves their text alone.

-- Migration 092 used to add a sentence to the privacy policy on every boot.
-- Collapse the copies: first the repeated email sentence, then the repeated
-- account-and-email pair. A page with no repeats is left as it is.
UPDATE admin_settings
SET value = regexp_replace(
  regexp_replace(
    value,
    '(We only email you to confirm your address or, if you ask, to reset your password\. ){2,}',
    '\1',
    'g'
  ),
  '(When you create an account with email, we store your name, the username you choose \(if any\), your email address, and either a password \(only as a salted scrypt hash, never the password itself\) or a passkey \(only its public key\)\. We only email you to confirm your address or, if you ask, to reset your password\. ){2,}',
  '\1',
  'g'
)
WHERE key = 'about_privacy_md'
  AND value LIKE '%to reset your password. We only email you%'
   OR key = 'about_privacy_md'
  AND value LIKE '%to reset your password. When you create an account with email%';

UPDATE admin_settings
SET value = replace(
  value,
  'That''s the full list. We don''t request access to your contacts, calendar, files, or anything else.',
  'That''s the full list. We don''t request access to your contacts, calendar, files, or anything else.

If you check off hikes for a seasonal challenge such as the Fall Hiking Spree, we store which hikes and the dates you give them. If you choose to fill in **Your details** in Settings (first and last name, mailing address, and cell number), we store those too. They are optional, and we use them for one thing: writing them onto a form you download, such as the Fall Hiking Spree form. That form is filled in on your own device; we don''t send it to anyone. If you are not signed in, your hikes and details are kept only in your browser.'
)
WHERE key = 'about_privacy_md'
  AND value NOT LIKE '%mailing address%';

UPDATE admin_settings
SET value = replace(value, '*Last updated: September 2026*', '*Last updated: October 2026*')
WHERE key = 'about_privacy_md'
  AND value LIKE '%mailing address%'
  AND value LIKE '%*Last updated: September 2026*%';

UPDATE admin_settings
SET value = replace(
  replace(
    value,
    '- Your favorites, visited places, and saved trips',
    '- Your favorites, visited places, and saved trips
- The hikes you checked off for seasonal challenges, and the badges earned from them'
  ),
  '- Your timezone and other preferences',
  '- Your timezone and other preferences
- Any details you saved for filling in forms: name, mailing address, and cell number'
)
WHERE key = 'about_data_deletion_md'
  AND value NOT LIKE '%mailing address%';

UPDATE admin_settings
SET value = replace(
  value,
  'your saved favorites, visited places, saved trips, and your site preferences.',
  'your saved favorites, visited places, saved trips, the hikes you check off for seasonal challenges, your site preferences, and any contact details you choose to add for filling in forms (mailing address and cell number).'
)
WHERE key = 'about_terms_md'
  AND value NOT LIKE '%mailing address%';
