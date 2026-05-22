-- Rename the trusted_event_paths admin setting to trusted_content_paths as part
-- of unifying the News & Events filter lists. Preserves the existing value.
INSERT INTO admin_settings (key, value, updated_at)
SELECT 'trusted_content_paths', value, CURRENT_TIMESTAMP
FROM admin_settings
WHERE key = 'trusted_event_paths'
ON CONFLICT (key) DO NOTHING;

DELETE FROM admin_settings WHERE key = 'trusted_event_paths';
