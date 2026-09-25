-- Migration: 089_news_pipelines
-- Description: Split news collection into two pipelines (spec 044). Current News
-- is what the newsletter and the /news page draw from; Historical News is the slow,
-- deliberate archive that publishes to POI pages only. The three tier jobs become
-- purpose jobs (Current News, Historical News, Events) and tier becomes a per-POI
-- cadence for Current News.
--
-- Runs on every boot (rotv-init.sh), so every statement is idempotent. initDatabase()
-- in server.js adds the same columns; this file keeps the migration path complete.

ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS pipeline TEXT NOT NULL DEFAULT 'current';
DO $$ BEGIN
  ALTER TABLE poi_news ADD CONSTRAINT poi_news_pipeline_check CHECK (pipeline IN ('current', 'historical'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS from_snippet BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS story_year INTEGER;
CREATE INDEX IF NOT EXISTS idx_poi_news_pipeline_collected ON poi_news(pipeline, collection_date);

-- Deterministic backfill: an item is historical when it was already more than 30 days
-- old when collected, or undated. Re-running yields the same labels.
UPDATE poi_news SET pipeline = 'historical'
WHERE pipeline = 'current'
  AND (publication_date IS NULL OR publication_date < collection_date - INTERVAL '30 days');

-- Snippet-recovery items store the search snippet as both summary and rendered_content.
UPDATE poi_news SET from_snippet = true
WHERE from_snippet = false AND rendered_content IS NOT NULL AND rendered_content = summary;

ALTER TABLE pois ADD COLUMN IF NOT EXISTS last_current_news_collection TIMESTAMPTZ;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS last_historical_collection TIMESTAMPTZ;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS history_dry_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS history_query_index INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  UPDATE pois SET last_current_news_collection = last_news_collection
  WHERE last_current_news_collection IS NULL AND last_news_collection IS NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

ALTER TABLE news_job_status ADD COLUMN IF NOT EXISTS pipeline TEXT;

INSERT INTO admin_settings (key, value, updated_at) VALUES
  ('news_current_window_days', '30', CURRENT_TIMESTAMP),
  ('news_history_max_urls', '3', CURRENT_TIMESTAMP),
  ('news_history_dry_run_limit', '3', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

-- Same-day news was held as a "future" date because the gate compared instants
-- (noon Eastern vs. the sweep's clock). The gate now compares calendar days; release
-- anything still stranded by the old rule so the sweep re-evaluates it.
UPDATE poi_news SET moderation_processed = false
WHERE moderation_status = 'pending' AND moderation_processed = true
  AND moderation_gates->'date'->>'reason' LIKE 'Future publication date%'
  -- Fix: compare Eastern calendar days like the new gate, so same-day items whose noon
  -- timestamp hasn't passed yet are released too (PR #623 review)
  AND (publication_date AT TIME ZONE 'America/New_York')::date <= (NOW() AT TIME ZONE 'America/New_York')::date;
