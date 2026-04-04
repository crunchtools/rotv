-- Migration 015: Add multi-media support via poi_media table
-- Created: 2026-04-04
-- Description: Replace photo_submissions with comprehensive poi_media table
--              supporting images, videos, and YouTube embeds.

-- ============================================================
-- 1. Create poi_media table
-- ============================================================
CREATE TABLE IF NOT EXISTS poi_media (
    id SERIAL PRIMARY KEY,
    poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
    media_type VARCHAR(20) NOT NULL,

    -- For images/videos: reference to image server asset
    image_server_asset_id VARCHAR(255),

    -- For YouTube embeds: the URL
    youtube_url TEXT,

    -- Display metadata
    role VARCHAR(20) DEFAULT 'gallery',
    sort_order INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,

    -- Moderation (reuses existing pattern from poi_news/poi_events)
    moderation_status VARCHAR(20) DEFAULT 'pending',
    confidence_score DECIMAL(3,2),
    ai_reasoning TEXT,
    submitted_by INTEGER REFERENCES users(id),
    moderated_by INTEGER REFERENCES users(id),
    moderated_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT poi_media_type_check CHECK (media_type IN ('image', 'video', 'youtube')),
    CONSTRAINT poi_media_role_check CHECK (role IN ('primary', 'gallery')),
    CONSTRAINT poi_media_asset_or_url CHECK (
        (media_type = 'youtube' AND youtube_url IS NOT NULL AND image_server_asset_id IS NULL) OR
        (media_type IN ('image', 'video') AND image_server_asset_id IS NOT NULL AND youtube_url IS NULL)
    )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_poi_media_poi_id ON poi_media(poi_id);
CREATE INDEX IF NOT EXISTS idx_poi_media_role ON poi_media(poi_id, role);
CREATE INDEX IF NOT EXISTS idx_poi_media_likes ON poi_media(poi_id, likes_count DESC);
CREATE INDEX IF NOT EXISTS idx_poi_media_created ON poi_media(poi_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poi_media_moderation ON poi_media(moderation_status);

-- One primary image per POI
CREATE UNIQUE INDEX IF NOT EXISTS idx_poi_media_unique_primary ON poi_media(poi_id)
    WHERE role = 'primary' AND moderation_status IN ('published', 'auto_approved');

-- ============================================================
-- 2. Migrate existing photo_submissions to poi_media
-- ============================================================
-- Migrate approved/published photo submissions
INSERT INTO poi_media (
    poi_id,
    media_type,
    image_server_asset_id,
    role,
    sort_order,
    moderation_status,
    confidence_score,
    ai_reasoning,
    submitted_by,
    moderated_by,
    moderated_at,
    created_at
)
SELECT
    poi_id,
    'image',
    image_server_asset_id,
    'gallery', -- All migrated photos start as gallery images
    0,
    COALESCE(moderation_status, 'published'), -- Default to published if null
    confidence_score,
    ai_reasoning,
    submitted_by,
    moderated_by,
    moderated_at,
    created_at
FROM photo_submissions
WHERE moderation_status IN ('approved', 'published', 'auto_approved')
   OR moderation_status IS NULL -- Legacy data without status
ON CONFLICT DO NOTHING;

-- Migrate pending photo submissions
INSERT INTO poi_media (
    poi_id,
    media_type,
    image_server_asset_id,
    role,
    sort_order,
    moderation_status,
    confidence_score,
    ai_reasoning,
    submitted_by,
    moderated_by,
    moderated_at,
    created_at
)
SELECT
    poi_id,
    'image',
    image_server_asset_id,
    'gallery',
    0,
    'pending',
    confidence_score,
    ai_reasoning,
    submitted_by,
    moderated_by,
    moderated_at,
    created_at
FROM photo_submissions
WHERE moderation_status = 'pending'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Migrate existing primary images from image server
-- ============================================================
-- Note: This requires querying the image server API to find primary images
-- Will be done by a separate Node.js script: scripts/migrate-primary-images.js

-- ============================================================
-- 4. Update moderation_queue view to include poi_media
-- ============================================================
DROP VIEW IF EXISTS moderation_queue CASCADE;

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
  SELECT id, 'photo' AS content_type, poi_id,
         CASE
           WHEN media_type = 'youtube' THEN 'YouTube: ' || SUBSTRING(youtube_url FROM 1 FOR 50)
           ELSE 'Image #' || id::TEXT
         END AS title,
         NULL AS description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at
  FROM poi_media WHERE moderation_status = 'pending'
  ORDER BY created_at DESC;

-- ============================================================
-- 5. Update newsletter_digest view to include poi_media
-- ============================================================
-- Note: poi_media doesn't have weekly_newsletter column (not needed for media)
-- Keeping view as-is for now, can extend later if needed

-- ============================================================
-- 6. Add admin setting for multi-media support
-- ============================================================
INSERT INTO admin_settings (key, value, updated_at)
VALUES
  ('multi_media_enabled', 'true', CURRENT_TIMESTAMP),
  ('video_upload_max_mb', '10', CURRENT_TIMESTAMP),
  ('media_admin_auto_approve', 'true', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 7. Add caption column to poi_media (optional, for future use)
-- ============================================================
ALTER TABLE poi_media ADD COLUMN IF NOT EXISTS caption TEXT;

-- ============================================================
-- NOTES:
-- - photo_submissions table is NOT dropped for backward compatibility
-- - Existing /api/pois/:id/photo endpoint will continue to work
-- - New /api/pois/:id/media endpoints will use poi_media table
-- - Migration script needed: backend/scripts/migrate-primary-images.js
-- ============================================================
