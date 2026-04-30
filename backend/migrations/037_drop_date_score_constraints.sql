-- Migration 037: Drop date_consensus_score range constraints
--
-- These constraints assumed a maximum score of 12, but pages with multiple
-- JSON-LD entries (e.g. Signal Akron) produce scores well above that ceiling.
-- The constraints are never queried against and serve no functional purpose —
-- they only cause save failures when high-confidence items exceed the cap.
ALTER TABLE poi_news   DROP CONSTRAINT IF EXISTS chk_news_date_score_range;
ALTER TABLE poi_events DROP CONSTRAINT IF EXISTS chk_events_date_score_range;
