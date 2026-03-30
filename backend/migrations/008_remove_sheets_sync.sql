-- Migration 008: Remove Google Sheets sync infrastructure
-- Sheets sync has been replaced by direct PostgreSQL + Drive backup workflow

-- Remove Sheets sync infrastructure
DROP TABLE IF EXISTS sync_queue;
DROP TABLE IF EXISTS sync_status;

-- Remove sync-related columns from pois
ALTER TABLE pois DROP COLUMN IF EXISTS locally_modified;
ALTER TABLE pois DROP COLUMN IF EXISTS synced;

-- Remove BYTEA image storage (image server is source of truth)
ALTER TABLE pois DROP COLUMN IF EXISTS image_data;
ALTER TABLE pois DROP COLUMN IF EXISTS image_mime_type;

-- Remove legacy Immich reference
ALTER TABLE pois DROP COLUMN IF EXISTS immich_primary_asset_id;

-- Clean up sync-related admin settings
DELETE FROM admin_settings WHERE key = 'sync_spreadsheet_id';
