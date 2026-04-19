-- LLM content relevance voting signals.
-- Stores raw vote results so items can be rescored without re-calling the LLM.
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS relevance_signals JSONB;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS relevance_signals JSONB;
