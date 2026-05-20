-- 057_add_user_timezone.sql
-- Per-user timezone preference (spec 018-anon-user-settings, issue #379).
-- Anonymous visitors set this in localStorage (key 'app-timezone'); on first
-- sign-in the /api/user/settings/sync endpoint fills this column when it is
-- still NULL (server-wins on subsequent syncs — never overwrites a value
-- already set from another device).
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;
