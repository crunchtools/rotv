-- Migration 043: Fix event times stored as local Eastern instead of UTC
--
-- Events collected before 2026-04-29 (commit 595f9a3) had a bug where
-- parseDateTime() extracted hour/minute/second components from chrono-node
-- without converting to UTC. Local Eastern times were stored as-is with
-- a +00 offset, making them display 4-5 hours early.
--
-- Fix: shift start_date and end_date forward by the correct UTC offset.
-- PostgreSQL's AT TIME ZONE handles EDT/EST automatically based on the
-- date, so we don't need to hardcode offsets.
--
-- The trick: the stored timestamp IS the local time with a wrong +00 offset.
-- To fix: interpret the stored value as if it were Eastern (strip UTC, treat
-- as local), then convert back to UTC properly.
--
-- Example: stored 2026-05-07 15:00:00+00 (meant 3 PM Eastern)
--   → strip offset: 2026-05-07 15:00:00 (bare timestamp)
--   → interpret as Eastern: 2026-05-07 15:00:00 America/New_York
--   → convert to UTC: 2026-05-07 19:00:00+00 (EDT, +4h)

-- Fix start_date
UPDATE poi_events
SET start_date = (start_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York'
WHERE collection_date < '2026-04-29'
  AND start_date IS NOT NULL
  AND EXTRACT(HOUR FROM start_date) != 0
  AND EXTRACT(HOUR FROM start_date) != 12;

-- Fix end_date
UPDATE poi_events
SET end_date = (end_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York'
WHERE collection_date < '2026-04-29'
  AND end_date IS NOT NULL
  AND EXTRACT(HOUR FROM end_date) != 0
  AND EXTRACT(HOUR FROM end_date) != 12;
