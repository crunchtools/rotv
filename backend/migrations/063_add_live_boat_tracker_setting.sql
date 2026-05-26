-- Migration: 063_add_live_boat_tracker_setting
-- Enable/disable the live boat position tracker (Socket.IO client to TrackMyShuttle).

-- admin_settings has only (key, value) columns — the original INSERT named a
-- nonexistent `description` column and errored on every run, so the setting was
-- never created. (PR #417 review)
INSERT INTO admin_settings (key, value)
VALUES ('live_boat_tracker_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
