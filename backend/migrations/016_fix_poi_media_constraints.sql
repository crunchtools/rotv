-- Migration 016: Fix poi_media table constraints
-- Created: 2026-04-04
-- Description: Address data integrity issues found in Gemini review of PR #182
--              1. Add 'rejected' to moderation_status CHECK constraint
--              2. Change user FKs to ON DELETE SET NULL
--              3. Add caption length constraint

-- ============================================================
-- 1. Drop and recreate moderation_status CHECK constraint
-- ============================================================
-- PostgreSQL doesn't support ALTER CONSTRAINT, so we drop and recreate

-- Drop existing constraint
ALTER TABLE poi_media DROP CONSTRAINT IF EXISTS poi_media_moderation_check;

-- Add complete constraint including 'rejected' state
ALTER TABLE poi_media ADD CONSTRAINT poi_media_moderation_check
  CHECK (moderation_status IN ('pending', 'published', 'auto_approved', 'rejected'));

-- ============================================================
-- 2. Fix user foreign key constraints (ON DELETE SET NULL)
-- ============================================================
-- Drop existing FKs and recreate with proper ON DELETE behavior

-- Drop existing constraints (find actual names first)
DO $$
DECLARE
    fk_name TEXT;
BEGIN
    -- Find and drop submitted_by FK
    SELECT conname INTO fk_name
    FROM pg_constraint
    WHERE conrelid = 'poi_media'::regclass
      AND contype = 'f'
      AND confrelid = 'users'::regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'poi_media'::regclass AND attname = 'submitted_by')];

    IF fk_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE poi_media DROP CONSTRAINT ' || fk_name;
    END IF;

    -- Find and drop moderated_by FK
    SELECT conname INTO fk_name
    FROM pg_constraint
    WHERE conrelid = 'poi_media'::regclass
      AND contype = 'f'
      AND confrelid = 'users'::regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'poi_media'::regclass AND attname = 'moderated_by')];

    IF fk_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE poi_media DROP CONSTRAINT ' || fk_name;
    END IF;
END $$;

-- Recreate FKs with ON DELETE SET NULL
ALTER TABLE poi_media
  ADD CONSTRAINT poi_media_submitted_by_fkey
  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE poi_media
  ADD CONSTRAINT poi_media_moderated_by_fkey
  FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================
-- 3. Add caption length constraint
-- ============================================================
ALTER TABLE poi_media ADD CONSTRAINT poi_media_caption_length_check
  CHECK (caption IS NULL OR length(caption) <= 200);

-- ============================================================
-- 4. Add moderation queue index for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_poi_media_moderation_queue
  ON poi_media(moderation_status, created_at);

-- ============================================================
-- NOTES:
-- - This migration addresses findings from Gemini review of PR #182
-- - See: .specify/specs/004-multi-image-poi/GEMINI_REVIEW.md
-- ============================================================
