-- Migration 069: close the concurrent-insert duplicate-URL race on poi_news.
--
-- saveNewsItems dedups with a SELECT-then-INSERT, which has no DB-level guard:
-- two concurrent collection branches can both read "not present" and both
-- insert the same URL (observed repeatedly on the historicbridges POI, e.g.
-- ids 1523/1524 and 2622/2623 inserted ~24ms apart). A unique index on the
-- normalized source_url turns that race into a clean no-op when paired with
-- ON CONFLICT DO NOTHING in the insert path.
--
-- Events are intentionally excluded: distinct events legitimately share a
-- generic source URL (a venue homepage or calendar page), so source_url is not
-- unique for poi_events.

-- Safety net: collapse any pre-existing normalized-URL duplicates before adding
-- the constraint, keeping the best row per URL (published > pending > rejected,
-- then lowest id). Idempotent -- a no-op once the table holds one row per URL.
DELETE FROM poi_news a
USING poi_news b
WHERE a.source_url IS NOT NULL
  AND b.source_url IS NOT NULL
  AND LOWER(REGEXP_REPLACE(a.source_url, '/+$', '')) = LOWER(REGEXP_REPLACE(b.source_url, '/+$', ''))
  AND (CASE a.moderation_status WHEN 'published' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, a.id)
    > (CASE b.moderation_status WHEN 'published' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS poi_news_source_url_norm_uniq
  ON poi_news (LOWER(REGEXP_REPLACE(source_url, '/+$', '')))
  WHERE source_url IS NOT NULL;
