-- Migration: 087_usft_sharing_token
-- Description: Move the USFT (CVSR train tracker) sharing token into admin_settings (#550)
-- so it syncs with `run.sh seed`, is rotatable from the admin UI, and no longer requires
-- a redeploy to change. The tracker falls back to process.env.USFT_SHARING_TOKEN while
-- this setting is empty, so production keeps running before the value is filled in.

INSERT INTO admin_settings (key, value, updated_at)
VALUES ('usft_sharing_token', '', NOW())
ON CONFLICT (key) DO NOTHING;
