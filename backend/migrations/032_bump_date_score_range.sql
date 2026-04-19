-- Bump date_consensus_score check constraint from 0-8 to 0-12.
-- JSON-LD weight increased from 3 to 4 points, making theoretical max:
-- json-ld(4) + meta(1) + time-tag(1) + url(1) + llm-consensus(4) = 11
-- Using 12 for headroom.

ALTER TABLE poi_news DROP CONSTRAINT IF EXISTS chk_news_date_score_range;
ALTER TABLE poi_news ADD CONSTRAINT chk_news_date_score_range
  CHECK (date_consensus_score >= 0 AND date_consensus_score <= 12);

ALTER TABLE poi_events DROP CONSTRAINT IF EXISTS chk_events_date_score_range;
ALTER TABLE poi_events ADD CONSTRAINT chk_events_date_score_range
  CHECK (date_consensus_score >= 0 AND date_consensus_score <= 12);
