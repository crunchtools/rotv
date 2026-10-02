-- Migration 090: Data deletion page + self-service account deletion (#700)
-- Seeds the admin-editable /data-deletion page (Meta requires a Data Deletion
-- Instructions URL for Facebook Login) and points the privacy policy's
-- "Delete your account" line at the new self-service path.
-- Idempotent: the seed never overwrites admin edits, and the replace() is a
-- no-op once applied (or if an admin has already reworded the line).

INSERT INTO admin_settings (key, value) VALUES
('about_data_deletion_md', '# Deleting Your Data

You can delete your Roots of the Valley account and the data tied to it yourself, at any time. No need to ask us.

## Delete Your Account

1. Sign in to [rootsofthevalley.org](https://rootsofthevalley.org) with the same Google or Facebook account you used before.
2. Open **Settings**.
3. Under **Your Account**, choose **Delete my account** and confirm.

Deletion is immediate and permanent. You are signed out on every device.

## What Gets Deleted

- Your name, email address, and profile photo
- The link between your account and Google or Facebook
- Your favorites, visited places, and saved trips
- Your notification and subscription settings
- Your timezone and other preferences
- Every active login session

## What Stays

Photos, videos, and news you contributed that were already published stay on the site under the license you granted when you uploaded them, but they are no longer connected to you. If you want a contribution taken down too, email us and we will remove it.

Our usage statistics never contained your identity, so there is nothing to delete there. Database backups taken before you deleted your account still contain it; they are kept privately and only used to recover the site after a failure.

If you subscribed to the newsletter, use the unsubscribe link at the bottom of any issue.

## Removing ROTV from Facebook or Google

Removing Roots of the Valley in your Facebook settings (**Settings & privacy › Settings › Apps and websites**) or your Google account (**Security › Third-party apps**) stops future sign-ins, but does not delete the data we already hold. Use the steps above for that.

## Can''t Sign In?

Email **admin@rootsofthevalley.org** from the address on your account and we will delete it for you within 30 days.')
ON CONFLICT (key) DO NOTHING;

UPDATE admin_settings
SET value = replace(
  value,
  '**Delete your account:** Contact us and we''ll remove all your data.',
  '**Delete your account:** Do it yourself any time from Settings. See [Deleting Your Data](/data-deletion) for exactly what is removed.'
)
WHERE key = 'about_privacy_md';
