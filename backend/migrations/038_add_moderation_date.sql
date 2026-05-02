-- Migration 038: Add moderation_date to track when auto-moderation processed an item.
-- Separate from moderated_at (which records human moderation actions).
ALTER TABLE poi_news   ADD COLUMN IF NOT EXISTS moderation_date TIMESTAMPTZ;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderation_date TIMESTAMPTZ;
