-- Migration 007: Add junction tables for multiple URLs per news/event item
-- Allows dedup pipeline to merge URLs into existing items instead of creating duplicates

CREATE TABLE IF NOT EXISTS poi_news_urls (
    id SERIAL PRIMARY KEY,
    news_id INTEGER NOT NULL REFERENCES poi_news(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    source_name VARCHAR(255),
    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_poi_news_urls_unique ON poi_news_urls(news_id, url);
CREATE INDEX IF NOT EXISTS idx_poi_news_urls_url ON poi_news_urls(url);

CREATE TABLE IF NOT EXISTS poi_event_urls (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES poi_events(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    source_name VARCHAR(255),
    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_poi_event_urls_unique ON poi_event_urls(event_id, url);
CREATE INDEX IF NOT EXISTS idx_poi_event_urls_url ON poi_event_urls(url);
