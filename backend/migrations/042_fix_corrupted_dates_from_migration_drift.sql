-- Migration 042: Fix dates corrupted by localToUTC bug + migration 036 compounding
--
-- The localToUTC() function had a double-seconds bug that caused noon-Eastern
-- promotion to fail, writing bare date strings as midnight UTC. Migration 036
-- then added +12h on each container restart (before PR #306 fixed idempotency),
-- shifting dates forward by up to 2+ days.
--
-- This re-derives publication_date from date_signals.llmVotes where the LLM
-- votes unanimously agree but the stored date doesn't match.

UPDATE poi_news
SET publication_date = (
  (date_signals->'llmVotes'->>0)::date + interval '12 hours'
)
WHERE date_signals IS NOT NULL
  AND date_signals->'llmVotes' IS NOT NULL
  AND jsonb_array_length(date_signals->'llmVotes') >= 3
  AND (date_signals->'llmVotes'->>0) IS NOT NULL
  AND (date_signals->'llmVotes'->>0) = (date_signals->'llmVotes'->>1)
  AND (date_signals->'llmVotes'->>0) = (date_signals->'llmVotes'->>2)
  AND publication_date::date != (date_signals->'llmVotes'->>0)::date
  -- Only fix small drifts (1-5 days) caused by migration compounding.
  -- Larger mismatches may be LLM errors, not migration damage.
  AND ABS(publication_date::date - (date_signals->'llmVotes'->>0)::date) BETWEEN 1 AND 5;
