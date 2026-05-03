-- Migration 040: Fix midnight-UTC publication dates
--
-- publication_date is TIMESTAMPTZ (since migration 036). Date-only values must
-- be stored as noon UTC so that Eastern-time display never shifts the calendar day.
-- The moderation rescore path wrote bare YYYY-MM-DD strings that PostgreSQL
-- interpreted as midnight UTC, causing off-by-one display in the frontend.

UPDATE poi_news
SET publication_date = date_trunc('day', publication_date) + interval '12 hours'
WHERE publication_date IS NOT NULL
  AND publication_date::time = '00:00:00';

UPDATE poi_events
SET publication_date = date_trunc('day', publication_date) + interval '12 hours'
WHERE publication_date IS NOT NULL
  AND publication_date::time = '00:00:00';
