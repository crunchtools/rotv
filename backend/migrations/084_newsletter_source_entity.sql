-- 084_newsletter_source_entity.sql
-- Evolve poi_newsletter_sources from a POI->sender mapping table into a
-- first-class newsletter source entity (spec 037, issue #524).
--
-- Changes:
--   1. Change PK from (poi_id, from_pattern) to (from_pattern) alone
--   2. Make poi_id nullable (blocked/new sources have no POI)
--   3. Add display_name and status columns
--
-- Idempotent: safe to re-run on every container start.

-- Step 1: Add new columns (idempotent via IF NOT EXISTS)
ALTER TABLE poi_newsletter_sources
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted';

-- Step 2: Restructure primary key BEFORE dropping NOT NULL.
-- PostgreSQL won't allow DROP NOT NULL on a PK column, so we must
-- remove poi_id from the PK first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_newsletter_sources_pkey'
      AND conrelid = 'poi_newsletter_sources'::regclass
  ) THEN
    IF (
      SELECT COUNT(*) FROM pg_attribute a
      JOIN pg_constraint c ON a.attrelid = c.conrelid
        AND a.attnum = ANY(c.conkey)
      WHERE c.conname = 'poi_newsletter_sources_pkey'
        AND c.conrelid = 'poi_newsletter_sources'::regclass
    ) > 1 THEN
      ALTER TABLE poi_newsletter_sources DROP CONSTRAINT poi_newsletter_sources_pkey;
      ALTER TABLE poi_newsletter_sources ADD PRIMARY KEY (from_pattern);
    END IF;
  END IF;
END $$;

-- Step 3: Make poi_id nullable (now safe since it's no longer in the PK)
ALTER TABLE poi_newsletter_sources ALTER COLUMN poi_id DROP NOT NULL;
