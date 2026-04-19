-- Cache rendered page content and date signals at collection time.
-- Eliminates redundant Playwright rendering and LLM calls during moderation.
-- rendered_content: full extracted page text (rawText from contentExtractor)
-- date_signals: all raw date sources + LLM votes as JSONB (enables rescoring without re-crawling)

ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS rendered_content TEXT;
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS date_signals JSONB;

ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS rendered_content TEXT;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS date_signals JSONB;
