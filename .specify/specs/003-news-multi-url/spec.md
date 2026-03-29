# Specification: Multiple URLs per News/Event Item

> **Spec ID:** 003-news-multi-url
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-03-28

## Overview

News and event items often have multiple web pages covering the same real-world story (e.g., a road closure reported by both the city website and a park alert). Currently each URL creates a separate item, producing duplicates in the UI. This feature allows multiple source URLs to be associated with a single news or event item, with the oldest item as the canonical record and newer URLs appended as additional sources.

---

## User Stories

### Content Deduplication

**US-001: Automatic URL Merging on Ingest**
> As the AI content pipeline, I want to add a new URL to an existing news/event item when the content is semantically the same, so that the public site shows one story with multiple sources instead of duplicate cards.

Acceptance Criteria:
- [ ] When a new item's URL matches an existing item (same POI, similar title), the URL is added to the existing item's URL list instead of creating a new row
- [ ] The oldest item is always the canonical record (title, summary preserved)
- [ ] The `source_url` column on `poi_news`/`poi_events` remains the primary display URL (backward compatible)

**US-002: Manual Merge in Moderation Queue**
> As an admin, I want to merge two news/event items that are about the same story, so that I can fix duplicates the AI pipeline missed.

Acceptance Criteria:
- [ ] Moderation queue has a "Merge" action button on news/event items
- [ ] Merge presents a list of recent items from the same POI to merge with
- [ ] Oldest item wins: its title/summary are kept, the merged item's URL is added
- [ ] The merged (newer) item is deleted after its URL is transferred

**US-003: Multiple Sources Display**
> As a public user, I want to see all sources for a news story, so that I can choose which to read.

Acceptance Criteria:
- [ ] News cards show "Source" link for primary URL (current behavior)
- [ ] When additional URLs exist, show "N sources" link that expands to show all URLs

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `poi_news_urls` | Additional source URLs for news items (beyond the primary `source_url`) |
| `poi_event_urls` | Additional source URLs for event items (beyond the primary `source_url`) |

### Schema Changes

```sql
-- Additional URLs for news items
CREATE TABLE IF NOT EXISTS poi_news_urls (
    id SERIAL PRIMARY KEY,
    news_id INTEGER NOT NULL REFERENCES poi_news(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    source_name VARCHAR(255),
    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_poi_news_urls_news_id ON poi_news_urls(news_id);
CREATE INDEX IF NOT EXISTS idx_poi_news_urls_url ON poi_news_urls(url);

-- Additional URLs for event items
CREATE TABLE IF NOT EXISTS poi_event_urls (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES poi_events(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    source_name VARCHAR(255),
    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_poi_event_urls_event_id ON poi_event_urls(event_id);
CREATE INDEX IF NOT EXISTS idx_poi_event_urls_url ON poi_event_urls(url);
```

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/admin/moderation/merge` | Merge two items (keep oldest, transfer URL) | Admin |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/pois/:id/news` | Include `additional_urls` array |
| GET | `/api/news/recent` | Include `additional_urls` array |
| GET | `/api/pois/:id/events` | Include `additional_urls` array |
| GET | `/api/events/upcoming` | Include `additional_urls` array |
| GET | `/api/events/past` | Include `additional_urls` array |

---

## UI/UX Requirements

### Moderation Queue Changes

- **Merge button** on news/event items (not photos)
- Merge flow: click "Merge" -> see recent items from same POI -> select target -> confirm
- After merge: merged item deleted, URL added to target's URL list

### Public News/Events Display

- When `additional_urls` is non-empty, show "N sources" instead of single source link
- Clicking expands to show all URLs with source names

---

## Non-Functional Requirements

**NFR-001: Backward Compatibility**
- The `source_url` column remains the primary URL (no schema migration on existing columns)
- All existing queries continue to work unchanged
- Additional URLs are additive only

---

## Dependencies

- Depends on: v1.20.0 (cross-POI URL dedup, moderation queue UI)
- Blocks: none

---

## Open Questions

1. ~~Should events also support multiple URLs?~~ Yes, same pattern.
2. Should the merge operation be available via MCP tools? (Defer to follow-up)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-03-28 | Initial draft |
