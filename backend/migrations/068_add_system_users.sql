-- 068_add_system_users.sql
-- Create system user accounts for auto-publisher and MCP admin so that
-- moderated_by always has an audit trail.

INSERT INTO users (id, email, name, oauth_provider, oauth_provider_id, is_admin, role)
VALUES
  (-1, 'auto-publisher@system.rotv', 'Auto-Publisher', 'system', 'auto-publisher', false, 'viewer'),
  (-2, 'mcp@system.rotv', 'MCP Admin', 'system', 'mcp-admin', false, 'viewer')
ON CONFLICT (id) DO NOTHING;

-- Backfill: tag the 508 existing auto-published items with the system user
UPDATE poi_news SET moderated_by = -1, moderated_at = COALESCE(moderated_at, moderation_date)
WHERE moderation_status = 'published' AND moderated_by IS NULL AND content_source = 'ai';

UPDATE poi_events SET moderated_by = -1, moderated_at = COALESCE(moderated_at, moderation_date)
WHERE moderation_status = 'published' AND moderated_by IS NULL AND content_source = 'ai';
