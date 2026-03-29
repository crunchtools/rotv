-- Migration 006: Store AI moderation issues as structured data
-- Enables quick triage chips (URL, Date, Other) in the moderation queue

ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS ai_issues TEXT;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS ai_issues TEXT;
