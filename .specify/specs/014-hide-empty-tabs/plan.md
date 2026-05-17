# Implementation Plan: Hide Empty Tabs in POI Sidebar

> **Spec ID:** 014-hide-empty-tabs
> **Status:** Planning
> **Last Updated:** 2026-05-16
> **Estimated Effort:** S

## Summary

Backend adds `news_count`, `events_count`, `associations_count` to POI detail responses via subqueries. Frontend computes a `visibleTabs` set from those counts plus `historical_description` and renders tab buttons conditionally. Admins in edit mode bypass the filter.

---

## Architecture

### Data Flow

1. User clicks a POI on the map.
2. Sidebar fetches `/api/pois/:id` (or `/api/destinations/:id` / `/api/linear-features/:id`).
3. Response now includes `news_count`, `events_count`, `associations_count`.
4. Sidebar computes `visibleTabs` array. `view` always present. `news`, `events`, `history`, `associations` included iff their count/field is non-empty (or user is admin in edit mode).
5. Tab buttons render via `visibleTabs.map(...)`.
6. If `sidebarTab` ∉ `visibleTabs`, reset to `view`.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Counts | SQL subqueries in existing POI queries | Single round trip, no client-side count fetches |
| Tab gating | Array filter + map in JSX | Replaces hardcoded button list with data-driven render |

---

## Implementation Steps

### Phase 1: Backend Counts

- [ ] Augment `/api/pois/:id` query in `backend/server.js` to compute three counts via correlated subqueries
- [ ] Augment `/api/destinations/:id` and `/api/linear-features/:id` likewise (verify which endpoints the sidebar uses for each POI type)
- [ ] Test query plans manually with a representative POI to confirm low cost

### Phase 2: Frontend Tab Gating

- [ ] In `Sidebar.jsx`, derive `visibleTabs` based on POI data + admin/edit state
- [ ] Replace hardcoded tab button JSX with a render driven by `visibleTabs` (apply at both occurrences — destinations and linear features)
- [ ] Add a `useEffect` that resets `sidebarTab` to `'view'` when current tab is filtered out
- [ ] Verify deep-link routing still works (URL → sidebarTab synchronization)

### Phase 3: Verification

- [ ] Manual: open a POI with all 5 tabs populated → all visible
- [ ] Manual: open a POI with only Info → only Info visible
- [ ] Manual: open a POI with News + Events, no History/Associations → 3 tabs
- [ ] Manual: admin in edit mode → all 5 visible regardless
- [ ] Manual: deep-link to `/some-poi/associations` where empty → falls back to Info
- [ ] Manual: linear feature (trail) → same logic applies

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | Add count subqueries to `/api/pois/:id`, `/api/destinations/:id`, `/api/linear-features/:id` |
| `frontend/src/components/Sidebar.jsx` | Derive `visibleTabs`, render tabs from array, reset active tab if filtered |

No new files. No migrations.

---

## API Implementation

### Endpoint: `GET /api/pois/:id` (modified)

**Response (new fields):**
```json
{
  "id": 123,
  "name": "Example POI",
  "historical_description": null,
  "news_count": 4,
  "events_count": 0,
  "associations_count": 2
}
```

Counts are integers. Visibility threshold is `> 0`.

---

## Testing Strategy

### Manual Testing

1. Open POI with no News/Events/History/Associations → only Info tab visible
2. Open POI with News only → Info + News tabs visible
3. Open POI with all categories → all 5 tabs visible
4. Sign in as admin, enable edit mode, open empty POI → all 5 tabs visible
5. Deep-link to `/poi-slug/associations` on POI with no associations → URL resolves to Info tab
6. Add a news item via admin, refresh page as public viewer → News tab now appears
7. Open a linear feature (trail) with empty Associations → Associations tab hidden

### Automated

Existing Playwright smoke tests should still pass (they test core map functionality, not tab visibility). No new tests required for this PATCH-scope behavioral tweak; if Gemini review flags coverage, add one Playwright test.

---

## Rollback Plan

Revert the PR. The migration is purely additive (response fields + frontend filter), so revert is safe.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Count subqueries slow down POI detail fetch | Low | Subqueries hit `poi_id` indexed columns; verify with EXPLAIN |
| Deep-link routing breaks when target tab is hidden | Med | Add useEffect to fall back to Info + update URL |
| Admin loses access to empty tabs | High | Bypass filter when `isAdmin && editMode` |
| Tab strip layout shifts when tabs disappear | Low | Existing CSS handles variable child count |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-16 | Initial plan |
