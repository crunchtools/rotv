-- Migration 004: Replace ai_generated with content_source, add newsletter_emails table
-- Supports: human, ai, newsletter, feed, api, community

-- Step 1: Add content_source column with default 'ai' (matches existing ai_generated=TRUE behavior)
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS content_source VARCHAR(20) DEFAULT 'ai';
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS content_source VARCHAR(20) DEFAULT 'ai';

-- Step 2: Backfill and drop ai_generated (uses dynamic SQL to avoid parse errors if column missing)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'poi_news' AND column_name = 'ai_generated') THEN
        EXECUTE 'UPDATE poi_news SET content_source = ''human'' WHERE submitted_by IS NOT NULL AND ai_generated = FALSE';
        EXECUTE 'UPDATE poi_events SET content_source = ''human'' WHERE submitted_by IS NOT NULL AND ai_generated = FALSE';
        ALTER TABLE poi_news DROP COLUMN ai_generated;
        ALTER TABLE poi_events DROP COLUMN ai_generated;
        RAISE NOTICE 'Migration 004: Replaced ai_generated with content_source';
    END IF;
END $$;

-- Step 3: Add CHECK constraints for valid content_source values
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_news_content_source') THEN
        ALTER TABLE poi_news ADD CONSTRAINT chk_news_content_source
            CHECK (content_source IN ('human', 'ai', 'newsletter', 'feed', 'api', 'community'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_content_source') THEN
        ALTER TABLE poi_events ADD CONSTRAINT chk_events_content_source
            CHECK (content_source IN ('human', 'ai', 'newsletter', 'feed', 'api', 'community'));
    END IF;
END $$;

-- Step 4: Index for content_source filtering
CREATE INDEX IF NOT EXISTS idx_poi_news_content_source ON poi_news(content_source);
CREATE INDEX IF NOT EXISTS idx_poi_events_content_source ON poi_events(content_source);

-- Step 5: Newsletter emails table (audit trail + reprocessing)
CREATE TABLE IF NOT EXISTS newsletter_emails (
  id SERIAL PRIMARY KEY,
  from_address VARCHAR(500),
  subject VARCHAR(1000),
  body_html TEXT,
  body_text TEXT,
  body_markdown TEXT,
  processed BOOLEAN DEFAULT FALSE,
  news_extracted INTEGER DEFAULT 0,
  events_extracted INTEGER DEFAULT 0,
  error_message TEXT,
  received_at TIMESTAMP,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_newsletter_emails_processed ON newsletter_emails(processed);
