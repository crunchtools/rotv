-- Migration 011: Add trigram index for moderation queue search
-- Enables fast ILIKE searches on news titles/summaries and event titles/descriptions.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_poi_news_title_trgm ON poi_news USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_poi_news_summary_trgm ON poi_news USING GIN (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_poi_events_title_trgm ON poi_events USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_poi_events_desc_trgm ON poi_events USING GIN (description gin_trgm_ops);
