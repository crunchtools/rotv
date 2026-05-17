-- 050_add_trail_status_content_hash.sql
-- Adds content_hash column to trail_status so identical rendered pages can skip Gemini extraction.

ALTER TABLE trail_status ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
