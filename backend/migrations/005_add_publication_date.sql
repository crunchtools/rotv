-- Migration 005: Add publication date extraction fields
-- Stores AI-extracted or estimated publication dates for news and events.
-- Three-tier confidence: exact (date found), estimated (inferred), unknown (no date).
-- Staleness is NOT a rejection criterion — old content has archival value.

-- ============================================================
-- 1. Add publication_date and date_confidence to poi_news
-- ============================================================
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS publication_date DATE;
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS date_confidence VARCHAR(10) DEFAULT 'unknown';

-- ============================================================
-- 2. Add publication_date and date_confidence to poi_events
-- ============================================================
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS publication_date DATE;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS date_confidence VARCHAR(10) DEFAULT 'unknown';

-- ============================================================
-- 3. CHECK constraints for date_confidence values
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_news_date_confidence') THEN
        ALTER TABLE poi_news ADD CONSTRAINT chk_news_date_confidence
            CHECK (date_confidence IN ('exact', 'estimated', 'unknown'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_date_confidence') THEN
        ALTER TABLE poi_events ADD CONSTRAINT chk_events_date_confidence
            CHECK (date_confidence IN ('exact', 'estimated', 'unknown'));
    END IF;
END $$;

-- ============================================================
-- 4. Update moderation_queue VIEW to include new columns
-- ============================================================
CREATE OR REPLACE VIEW moderation_queue AS
  SELECT id, 'news' AS content_type, poi_id, title, summary AS description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at,
         publication_date, date_confidence
  FROM poi_news WHERE moderation_status = 'pending'
  UNION ALL
  SELECT id, 'event' AS content_type, poi_id, title, description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at,
         publication_date, date_confidence
  FROM poi_events WHERE moderation_status = 'pending'
  UNION ALL
  SELECT id, 'photo' AS content_type, poi_id, original_filename AS title, caption AS description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at,
         NULL::DATE AS publication_date, NULL::VARCHAR(10) AS date_confidence
  FROM photo_submissions WHERE moderation_status = 'pending'
  ORDER BY created_at DESC;
