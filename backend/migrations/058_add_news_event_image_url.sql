-- 058_add_news_event_image_url.sql
-- Source-article share image for news/events (priority: source image > POI photo > brand).
-- Populated at collection time from the article's og:image; backfilled for existing rows.
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Cache the source page's og:image so re-collection / backfill keeps it on cache hits.
ALTER TABLE rendered_page_cache ADD COLUMN IF NOT EXISTS og_image TEXT;
