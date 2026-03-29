# Implementation Plan: Multiple URLs per News/Event Item

> **Spec ID:** 003-news-multi-url
> **Status:** Planning
> **Last Updated:** 2026-03-28
> **Estimated Effort:** M

## Summary

Add junction tables for additional URLs on news/event items. Modify the dedup logic to merge URLs into existing items instead of skipping. Add a manual "Merge" action in the moderation queue. Update public API responses to include additional URLs.

---

## Architecture

### Data Flow

1. AI pipeline discovers a new article URL
2. Dedup check finds an existing item with similar title (same POI)
3. Instead of `continue` (skip), insert the new URL into `poi_news_urls` for the existing item
4. Public API joins additional URLs into the response
5. Frontend shows "N sources" when multiple URLs exist

### Merge Flow (Manual)

1. Admin clicks "Merge" on item B in moderation queue
2. UI shows recent items from same POI as merge targets
3. Admin selects item A (the one to keep)
4. Backend: inserts item B's `source_url` into `poi_news_urls` for item A, deletes item B

---

## Implementation Steps

### Phase 1: Database

- [ ] Create migration `007_news_multi_url.sql`
- [ ] Add `poi_news_urls` and `poi_event_urls` tables
- [ ] Update `initDatabase()` in server.js with CREATE TABLE + indexes

### Phase 2: Dedup Logic (saveNewsItems / saveEventItems)

- [ ] When dedup finds an existing item with similar title (but different URL), insert the new URL into the junction table instead of silently skipping
- [ ] Log: "Merged URL into existing news #123" instead of "Skipping duplicate"
- [ ] Only merge when the reason is "similar title" — "same URL" still skips entirely

### Phase 3: API Responses

- [ ] Update `/api/pois/:id/news` to LEFT JOIN `poi_news_urls` and return `additional_urls` array
- [ ] Update `/api/news/recent` similarly
- [ ] Update `/api/pois/:id/events`, `/api/events/upcoming`, `/api/events/past` similarly
- [ ] Update moderation `getQueue` and `getItemDetail` to include additional URLs

### Phase 4: Merge Endpoint

- [ ] Add `POST /api/admin/moderation/merge` route
- [ ] Params: `{ sourceType, sourceId, targetId }` — merge source into target
- [ ] Logic: move source's `source_url` to target's junction table, move any of source's junction URLs too, delete source
- [ ] Add `mergeItems` function in moderationService.js

### Phase 5: Frontend - Moderation Queue

- [ ] Add "Merge" button to news/event items in ModerationInbox.jsx
- [ ] Merge flow: modal/dropdown showing recent items from same POI
- [ ] Show additional URLs in expanded item detail

### Phase 6: Frontend - Public Display

- [ ] Update ParkNews.jsx: show "N sources" when additional_urls is non-empty
- [ ] Update ParkEvents.jsx: same pattern
- [ ] Show expandable list of all source URLs

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/007_news_multi_url.sql` | Junction tables for additional URLs |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | Add CREATE TABLE for junction tables in initDatabase(), update news/events API queries to include additional_urls |
| `backend/services/newsService.js` | Modify saveNewsItems/saveEventItems dedup to merge URLs instead of skip |
| `backend/services/moderationService.js` | Add mergeItems function, update getQueue/getItemDetail |
| `backend/routes/admin.js` | Add merge endpoint |
| `frontend/src/components/ModerationInbox.jsx` | Merge button and flow |
| `frontend/src/components/ParkNews.jsx` | Multi-source display |
| `frontend/src/components/ParkEvents.jsx` | Multi-source display |

---

## Database Migrations

```sql
-- Migration: 007_news_multi_url
-- Description: Junction tables for multiple source URLs per news/event item

CREATE TABLE IF NOT EXISTS poi_news_urls (
    id SERIAL PRIMARY KEY,
    news_id INTEGER NOT NULL REFERENCES poi_news(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    source_name VARCHAR(255),
    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_poi_news_urls_news_id ON poi_news_urls(news_id);
CREATE INDEX IF NOT EXISTS idx_poi_news_urls_url ON poi_news_urls(url);

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

## Testing Strategy

### Manual Testing

1. Run news collection for a POI that produces semantically similar items
2. Verify that similar-title items merge URLs instead of creating duplicates
3. Test merge button in moderation queue: merge two items, verify URL transfer and deletion
4. Verify public news page shows "N sources" for items with multiple URLs
5. Verify single-URL items display unchanged (backward compatibility)

---

## Rollback Plan

If issues are discovered:
1. Junction tables are additive — dropping them restores original behavior
2. The `source_url` column is untouched, so all existing functionality works without the junction tables

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| False positive title matching merges unrelated items | Med | Only merge on "similar title" match, not URL match. Admin can unmerge via edit. |
| N+1 query for additional URLs on list endpoints | Low | Use LEFT JOIN with array_agg, single query |
| Merge deletes an item the admin wanted to keep | Low | Confirm dialog before merge. Oldest item always wins. |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-03-28 | Initial plan |
