-- Rendered page cache: stores Playwright extraction results keyed by URL.
-- TTL depends on page_type: detail = forever, listing = 23h, trail_status = 25min.
-- Checked before rendering; cache miss triggers Playwright.
CREATE TABLE IF NOT EXISTS rendered_page_cache (
  url TEXT PRIMARY KEY,
  markdown TEXT,
  raw_text TEXT,
  og_dates JSONB,
  title TEXT,
  links JSONB,
  page_type TEXT,
  rendered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rendered_page_cache_rendered_at ON rendered_page_cache (rendered_at);
