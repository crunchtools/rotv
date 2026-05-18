-- 054_add_newsletter_preview_email_setting.sql
-- Seed the admin setting that controls who receives the Thursday-morning
-- newsletter preview send. Admins can update this via settings_update.
-- Empty string disables the cron send (handler short-circuits).

INSERT INTO admin_settings (key, value)
VALUES ('newsletter_preview_email', 'scott.mccarty@gmail.com')
ON CONFLICT (key) DO NOTHING;
