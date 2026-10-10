-- Migration 098: Cleveland Metroparks events URL without a hard-coded year (#732)
-- POI 5658's WebTrac search carried beginyear=2025, so the crawl kept asking for
-- last year's programs. Only that parameter goes; the type= filters stay (widening
-- the crawl is a pending product/ToS decision). The second replace drops a '?' or
-- '&' left dangling when the parameter was the last one.
-- Idempotent: runs on every boot, no-op once the parameter is gone.

UPDATE pois
SET events_url = regexp_replace(
  regexp_replace(events_url, '([?&])beginyear=2025(&|$)', '\1'),
  '[?&]$', ''
)
WHERE id = 5658
  AND events_url LIKE '%beginyear=2025%';
