-- Migration: Add Moderation Queue for UGC and AI Content
-- Created: 2026-03-23
-- Description: Add moderation pipeline for AI-generated content, photo submissions,
--              and unified admin inbox. Existing content defaults to 'published'.

-- ============================================================
-- 1. Add moderation columns to poi_news
-- ============================================================
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'published';
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2);
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS ai_reasoning TEXT;
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS moderated_by INTEGER REFERENCES users(id);
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP;
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id);
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS weekly_newsletter BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_poi_news_moderation ON poi_news(moderation_status);

-- ============================================================
-- 2. Add moderation columns to poi_events
-- ============================================================
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'published';
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2);
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS ai_reasoning TEXT;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderated_by INTEGER REFERENCES users(id);
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id);
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS weekly_newsletter BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_poi_events_moderation ON poi_events(moderation_status);

-- ============================================================
-- 3. Create photo_submissions table
-- ============================================================
CREATE TABLE IF NOT EXISTS photo_submissions (
  id SERIAL PRIMARY KEY,
  poi_id INTEGER REFERENCES pois(id) ON DELETE CASCADE,
  image_server_asset_id VARCHAR(255),
  original_filename VARCHAR(500),
  submitted_by INTEGER REFERENCES users(id),
  caption TEXT,
  moderation_status VARCHAR(20) DEFAULT 'pending',
  confidence_score DECIMAL(3,2),
  ai_reasoning TEXT,
  moderated_by INTEGER REFERENCES users(id),
  moderated_at TIMESTAMP,
  weekly_newsletter BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_photo_submissions_status ON photo_submissions(moderation_status);
CREATE INDEX IF NOT EXISTS idx_photo_submissions_poi ON photo_submissions(poi_id);

-- ============================================================
-- 4. Unified moderation queue VIEW
-- ============================================================
CREATE OR REPLACE VIEW moderation_queue AS
  SELECT id, 'news' AS content_type, poi_id, title, summary AS description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at
  FROM poi_news WHERE moderation_status = 'pending'
  UNION ALL
  SELECT id, 'event' AS content_type, poi_id, title, description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at
  FROM poi_events WHERE moderation_status = 'pending'
  UNION ALL
  SELECT id, 'photo' AS content_type, poi_id, original_filename AS title, caption AS description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at
  FROM photo_submissions WHERE moderation_status = 'pending'
  ORDER BY created_at DESC;

-- ============================================================
-- 5. Newsletter digest VIEW (schema only, no email integration)
-- ============================================================
CREATE OR REPLACE VIEW newsletter_digest AS
  SELECT id, 'news' AS content_type, poi_id, title, summary AS description,
         created_at, moderated_at
  FROM poi_news
  WHERE moderation_status IN ('published', 'auto_approved')
    AND weekly_newsletter = TRUE
    AND created_at >= NOW() - INTERVAL '7 days'
  UNION ALL
  SELECT id, 'event' AS content_type, poi_id, title, description,
         created_at, moderated_at
  FROM poi_events
  WHERE moderation_status IN ('published', 'auto_approved')
    AND weekly_newsletter = TRUE
    AND created_at >= NOW() - INTERVAL '7 days'
  UNION ALL
  SELECT id, 'photo' AS content_type, poi_id, original_filename AS title, caption AS description,
         created_at, moderated_at
  FROM photo_submissions
  WHERE moderation_status IN ('approved', 'auto_approved')
    AND weekly_newsletter = TRUE
    AND created_at >= NOW() - INTERVAL '7 days'
  ORDER BY created_at DESC;

-- ============================================================
-- 6. Add moderation admin_settings defaults
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_settings') THEN
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES
      ('moderation_enabled', 'true', CURRENT_TIMESTAMP),
      ('moderation_auto_approve_threshold', '0.9', CURRENT_TIMESTAMP),
      ('moderation_auto_approve_enabled', 'true', CURRENT_TIMESTAMP),
      ('photo_submissions_enabled', 'false', CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO NOTHING;
  END IF;
END$$;
