# Implementation Plan: Favorites List (enriched) + rename

> **Spec ID:** 033-favorites-list
> **Status:** Planning
> **Last Updated:** 2026-06-01
> **Estimated Effort:** M

## Summary

Enrich `GET /api/favorites` with status + news/events counts via one `LEFT JOIN LATERAL`
query, then rebuild the My Valley "Favorites" tab to show those on clickable, sortable,
filterable rows — and rename "Following" → "Favorite" across UI copy and `MyValley.jsx`
internals. No schema or backend-table renames.

---

## Architecture

### Data Flow

1. My Valley opens → signed-in client GETs `/api/favorites?tz=<browser tz>`.
2. Backend returns favorite rows + `trail_status`, `news_count`, `events_count` (one query).
3. `MyValley` renders rows with `StatusBadge` + count chips; client-side sort/filter state
   reorders/filters the loaded array.
4. Row click → `generateSlug(name)` → `navigate('/' + slug)` + `onClose()`.
5. Anonymous → localStorage ids → name + navigate + remove only (no status/counts).

---

## Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Enrichment query | single `LEFT JOIN LATERAL` for status + two counts | No N+1; mirrors tab-counts rules |
| tz handling | reuse the whitelisted IANA regex from `/api/pois/:id/tab-counts` | Prevents `AT TIME ZONE` injection (PR #368 fix) |
| Status display | existing `StatusBadge` | `trail_status.status` values already match its config |
| Navigation | `generateSlug` + router `navigate` | Same path the map/gauges use (`/<slug>`) |
| Sort/filter | client-side `useMemo` over loaded list | Lists are small; instant, no round-trips |

---

## Implementation Steps

### Phase 1: Backend enrichment

- [ ] In `backend/routes/favorites.js` GET `/`, add `tz` whitelist + extend the query with:
  - `LEFT JOIN LATERAL (SELECT status FROM trail_status WHERE poi_id = p.id ORDER BY created_at DESC LIMIT 1) ts`
  - `LEFT JOIN LATERAL (SELECT COUNT(*) FROM poi_news … published/auto_approved) nc`
  - `LEFT JOIN LATERAL (SELECT COUNT(*) FROM poi_events … published/auto_approved AND future) ec`
  - return `trail_status`, `news_count` (int), `events_count` (int) alongside existing fields.

### Phase 2: Rename Following → Favorite

- [ ] `FavoriteToggle.jsx`: text `Following`/`Follow` → `Favorited`/`Favorite`; titles → `Remove from favorites` / `Add to favorites`.
- [ ] `MyValley.jsx`: tab label `⭐ Following` → `★ Favorites`; empty-state copy; docstring; internals `followingList`→`favoriteList`, `view==='following'`→`'favorites'`, `handleUnfollow`→`handleRemoveFavorite`.
- [ ] `NotificationBell.jsx`: "Follow places (★) …" → "Favorite places (★) …".
- [ ] Sweep `GuidedTour.jsx` for a favorites/follow step and align if present.

### Phase 3: Enriched, interactive list (MyValley)

- [ ] Render each row: clickable name → navigate + close; `StatusBadge` when `trail_status` set; count chips `📰 {news_count} 📅 {events_count}`; Remove button with `stopPropagation`.
- [ ] Add sort control (Recently added | Name A–Z | Most activity) and type-filter chips derived from `poi_roles` (shown only when >1 type present); apply via `useMemo`.
- [ ] Wire navigation (`useNavigate` in MyValley, or an `onNavigate` prop from App) and confirm `/<slug>` selects the POI.

### Phase 4: Styling

- [ ] `MyValley.css`: row layout for badge + chips + remove; sort/filter control styles; keep within the existing modal (`height:80vh`, z-index>nav per #429 gotcha).

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `backend/routes/favorites.js` | Enrich GET `/` with status + counts (+ tz whitelist) |
| `frontend/src/components/MyValley.jsx` | Rename + enriched/sortable/filterable favorites list + navigation |
| `frontend/src/components/FavoriteToggle.jsx` | Relabel to Favorite/Favorited |
| `frontend/src/components/NotificationBell.jsx` | "Favorite places" copy |
| `frontend/src/components/GuidedTour.jsx` | Align favorites step copy if present |
| `frontend/src/components/MyValley.css` | Row + controls styling |

### New Files

None.

---

## Database Migrations

None.

---

## API Implementation

### `GET /api/favorites?tz=America/New_York`

**Response (additive fields in bold):**
```json
[
  {
    "id": 42, "name": "Brandywine Falls", "poi_roles": ["trail"],
    "brief_description": "…", "has_primary_image": true,
    "favorited_at": "2026-05-30T12:00:00Z",
    "trail_status": "open", "news_count": 3, "events_count": 1
  }
]
```

---

## Testing Strategy

### Automated

- [ ] Extend `backend/tests` favorites coverage (or UI integration) to assert the enriched
  fields are present and numeric, and that the rename strings render. Update any test that
  asserts the old "Following" label or the old favorites response shape.

### Manual

1. Favorite a trail POI with news/events → open My Valley → row shows status badge + counts.
2. Click a row → navigates to the place, modal closes.
3. Remove (✕) → row disappears, no navigation.
4. Sort + filter behave; controls hidden when only one type.
5. Signed-out: favorites still list, navigate, and remove (no status/counts) — local-first intact.
6. Toggle/tab/notification copy all say "Favorite".

---

## Rollback Plan

1. Additive API + frontend-only UI — revert the changed files.
2. No migration to unwind.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `/api/favorites` shape change breaks a consumer | Med | Additive only; existing fields untouched |
| Rename misses a string → mixed "Follow/Favorite" copy | Low | Grep sweep for `follow`/`Following` in user-facing files during Phase 2 |
| Row click vs. Remove button event overlap | Low | `stopPropagation` on Remove |
| Tests assert old label/shape | Med | Update tests in Phase 1/2 (the #452 button-count test was a similar coupling) |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-06-01 | Initial plan |
