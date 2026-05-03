-- Migration 039: Add item count columns to rendered_page_cache.
-- Caches the Gemini itemCount result so repeat visits skip the LLM call.
ALTER TABLE rendered_page_cache ADD COLUMN IF NOT EXISTS item_count_news INTEGER;
ALTER TABLE rendered_page_cache ADD COLUMN IF NOT EXISTS item_count_events INTEGER;
