-- Migration 023: Remove published_at, rename created_at → collection_date on news/events
--
-- published_at is vestigial (same value as publication_date since PR #133).
-- created_at on poi_news/poi_events is renamed to collection_date for clarity
-- (it records when the row was collected, not a generic DB timestamp).
-- All other tables keep created_at unchanged.

-- 1. Drop the vestigial published_at column and its index from poi_news
DROP INDEX IF EXISTS idx_poi_news_published_at;
ALTER TABLE poi_news DROP COLUMN IF EXISTS published_at;

-- 2. Rename created_at → collection_date on poi_news
ALTER TABLE poi_news RENAME COLUMN created_at TO collection_date;

-- 3. Rename created_at → collection_date on poi_events
ALTER TABLE poi_events RENAME COLUMN created_at TO collection_date;
