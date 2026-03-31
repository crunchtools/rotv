-- Migration 009: Clean up legacy Immich admin settings
-- Immich was replaced by the lightweight image server in PR #104

DELETE FROM admin_settings WHERE key IN (
  'immich_api_key',
  'immich_server_url',
  'immich_album_id',
  'immich_poi_album_id'
);
