-- Migration: 063_add_live_boat_tracker_setting
-- Enable/disable the live boat position tracker (Socket.IO client to TrackMyShuttle).

INSERT INTO admin_settings (key, value, description)
VALUES ('live_boat_tracker_enabled', 'true',
        'Enable/disable the live boat position tracker (Socket.IO client to TrackMyShuttle)')
ON CONFLICT (key) DO NOTHING;
