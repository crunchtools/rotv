-- Migration 028: Replace date_confidence with date_consensus_score
--
-- date_confidence was a text label (exact/estimated/unknown) that lossy-bucketed
-- the numeric consensus score from the date extraction pipeline. Now we store
-- the raw integer score (0-8) directly so the moderation sweep can use it
-- for auto-approve decisions without re-rendering pages.

-- 1. Add date_consensus_score to poi_news and poi_events
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS date_consensus_score INTEGER DEFAULT 0;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS date_consensus_score INTEGER DEFAULT 0;

-- 2. Backfill from existing date_confidence
UPDATE poi_news SET date_consensus_score = CASE
  WHEN date_confidence = 'exact' THEN 6
  WHEN date_confidence = 'estimated' THEN 2
  ELSE 0
END WHERE date_consensus_score = 0 OR date_consensus_score IS NULL;

UPDATE poi_events SET date_consensus_score = CASE
  WHEN date_confidence = 'exact' THEN 6
  WHEN date_confidence = 'estimated' THEN 2
  ELSE 0
END WHERE date_consensus_score = 0 OR date_consensus_score IS NULL;

-- 3. Drop the vestigial date_confidence column
ALTER TABLE poi_news DROP COLUMN IF EXISTS date_confidence;
ALTER TABLE poi_events DROP COLUMN IF EXISTS date_confidence;
