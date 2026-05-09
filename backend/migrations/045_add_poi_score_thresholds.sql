-- Migration 045: Add per-POI score thresholds for news/events moderation
-- NULL = use global default (from admin_settings moderation_news_date_threshold)
-- When set, applies only to items whose source_url matches the POI's
-- configured news_url or events_url origin. Serper-sourced items still
-- use the global threshold.

ALTER TABLE pois ADD COLUMN IF NOT EXISTS news_score_threshold INTEGER;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS events_score_threshold INTEGER;
