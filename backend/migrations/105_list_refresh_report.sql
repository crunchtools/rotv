-- Migration 105: What the yearly refresh found when it drafted a list (spec 052, #778)
--   refresh_report holds the district's entries that matched no trail, trails
--   new or dropped since last year, changed miles or ratings, and what an admin
--   still has to add, for the review screen. NULL on lists made by hand.
-- Idempotent.

ALTER TABLE poi_lists ADD COLUMN IF NOT EXISTS refresh_report JSONB;
