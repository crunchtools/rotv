-- Migration: 047_fix_news_url_ownership
-- Description: Reassign news/events whose source_url domain matches a different
-- POI's news_url or events_url to the domain-owning POI.

-- Build a temporary domain→POI mapping from news_url and events_url
CREATE TEMPORARY TABLE poi_domain_map AS
SELECT DISTINCT ON (domain)
  domain,
  poi_id
FROM (
  SELECT
    id AS poi_id,
    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(news_url, '^https?://(www\.)?', ''), '/.*$', '')) AS domain
  FROM pois
  WHERE news_url IS NOT NULL AND deleted = false

  UNION ALL

  SELECT
    id AS poi_id,
    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(events_url, '^https?://(www\.)?', ''), '/.*$', '')) AS domain
  FROM pois
  WHERE events_url IS NOT NULL AND deleted = false
) sub
WHERE domain IS NOT NULL AND domain != ''
ORDER BY domain, poi_id;

-- Fix news items
UPDATE poi_news n
SET poi_id = dm.poi_id
FROM poi_domain_map dm
WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(n.source_url, '^https?://(www\.)?', ''), '/.*$', '')) = dm.domain
  AND n.poi_id != dm.poi_id
  AND n.source_url IS NOT NULL;

-- Fix events
UPDATE poi_events e
SET poi_id = dm.poi_id
FROM poi_domain_map dm
WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(e.source_url, '^https?://(www\.)?', ''), '/.*$', '')) = dm.domain
  AND e.poi_id != dm.poi_id
  AND e.source_url IS NOT NULL;

DROP TABLE poi_domain_map;
