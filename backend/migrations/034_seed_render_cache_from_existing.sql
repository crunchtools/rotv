-- Seed rendered_page_cache from existing rendered_content in poi_news and poi_events.
-- These are detail pages, so they get cached forever (page_type = 'detail').

INSERT INTO rendered_page_cache (url, raw_text, page_type, rendered_at)
SELECT DISTINCT ON (source_url)
  source_url,
  rendered_content,
  'detail',
  COALESCE(collection_date, NOW())
FROM poi_news
WHERE source_url IS NOT NULL
  AND rendered_content IS NOT NULL
ON CONFLICT (url) DO NOTHING;

INSERT INTO rendered_page_cache (url, raw_text, page_type, rendered_at)
SELECT DISTINCT ON (source_url)
  source_url,
  rendered_content,
  'detail',
  COALESCE(collection_date, NOW())
FROM poi_events
WHERE source_url IS NOT NULL
  AND rendered_content IS NOT NULL
ON CONFLICT (url) DO NOTHING;
