-- Rename legacy Google Drive column to a boolean flag
-- The column previously stored Google Drive file IDs, but the app now uses
-- a dedicated image server. Only truthiness matters.
ALTER TABLE pois RENAME COLUMN image_drive_file_id TO has_primary_image;
ALTER TABLE pois ALTER COLUMN has_primary_image TYPE BOOLEAN
  USING (has_primary_image IS NOT NULL);
ALTER TABLE pois ALTER COLUMN has_primary_image SET DEFAULT FALSE;
