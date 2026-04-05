-- Migration 017: Increase caption length limit
-- Created: 2026-04-04
-- Description: Increase poi_media caption limit from 200 to 2000 characters
--              to allow for more descriptive captions

-- Drop the existing 200-character constraint
ALTER TABLE poi_media DROP CONSTRAINT IF EXISTS poi_media_caption_length_check;

-- Add new constraint with 2000-character limit
ALTER TABLE poi_media ADD CONSTRAINT poi_media_caption_length_check
  CHECK (caption IS NULL OR length(caption) <= 2000);
