# Implementation Plan: News/Events URL Ownership

> **Spec ID:** 012-news-url-ownership
> **Status:** Planning
> **Last Updated:** 2026-05-14
> **Estimated Effort:** S

## Summary

Add a domain-ownership lookup to the news/events save functions. Before inserting, check if the source_url domain matches another POI's news_url or events_url — if so, reassign to that POI. Include a one-time migration to fix existing misattributed records.

---

## Architecture

### Data Flow

1. At collection start, build a domain→POI map from all POIs with news_url or events_url
2. In `saveNewsItems()` and `saveEventItems()`, extract domain from each item's source_url
3. Look up domain in the map — if it matches a different POI, swap poi_id before insert
4. Log the reassignment

---

## Implementation Steps

### Phase 1: Domain Ownership Lookup

- [ ] Add `buildDomainOwnershipMap(pool)` helper in `newsService.js` that queries all POIs with news_url/events_url and returns a `Map<domain, poiId>`
- [ ] Call it once at the start of `collectNewsForPoi()` (or pass it through from the job runner to avoid repeated queries)

### Phase 2: Reassignment in Save Functions

- [ ] In `saveNewsItems()`, before insert, check source_url domain against the map. If domain owner differs from target poiId, use the domain owner's poiId instead. Log the swap.
- [ ] In `saveEventItems()`, same logic.

### Phase 3: Data Migration

- [ ] Write migration `backend/migrations/XXX_fix_news_url_ownership.sql` that reassigns existing misattributed records
- [ ] Alternatively, run the fix as a Node script that uses the same domain map logic

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/newsService.js` | Add `buildDomainOwnershipMap()`, modify `saveNewsItems()` and `saveEventItems()` to check domain ownership before insert |

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/XXX_fix_news_url_ownership.sql` | One-time fix for existing misattributed records |

---

## Database Migrations

```sql
-- Migration: fix_news_url_ownership
-- Reassign news/events whose source_url domain matches a different POI's news_url or events_url

-- (Domain extraction + UPDATE joins against pois table)
```

---

## Testing Strategy

### Manual Testing

1. Run collection for a physical POI that has content from an org domain
2. Verify collected items are assigned to the org POI, not the physical POI
3. Verify migration corrects existing misattributed records

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Domain map becomes stale during long collection runs | Low | Rebuild map at job start; runs are <30min |
| False positive: generic domains (e.g., nps.gov) matching wrong POI | Med | Only match against POIs that have explicit news_url/events_url set |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-14 | Initial plan |
