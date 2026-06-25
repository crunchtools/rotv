# Implementation Plan: Shareable Legend Filters

> **Spec ID:** 039-shareable-legend-filters
> **Status:** Planning
> **Last Updated:** 2026-06-24
> **Estimated Effort:** S

## Summary

Frontend-only change. Read `?types=` and `?boundaries=` on page load to override the default filter state, then update the URL via `replaceState` whenever the user toggles legend items.

---

## Architecture

### Data Flow

1. Page loads → existing URL-parsing `useEffect` reads `types` and `boundaries` query params
2. Store parsed values in refs (`urlTypes`, `urlBoundaries`) for the init effects to consume
3. Existing `hasInitializedVisibleTypes` and `hasInitializedBoundaries` effects check refs and use URL values instead of defaults when present
4. Every `setVisibleTypes` / `setVisibleBoundaries` call triggers a new `useEffect` that syncs the current state back to the URL via `replaceState`

---

## Implementation Steps

### Phase 1: Read URL params on load

- [ ] In App.jsx URL-parsing effect (~line 731), parse `types` and `boundaries` query params
- [ ] Store in refs so the init effects can read them without re-triggering
- [ ] Consume `types` param in the `hasInitializedVisibleTypes` effect: if URL specified types, use those instead of computing from iconConfig
- [ ] Consume `boundaries` param in the `hasInitializedBoundaries` effect: if URL specified boundary IDs, use those instead of defaulting to CVNP

### Phase 2: Sync state back to URL

- [ ] Add a `useEffect` watching `[visibleTypes, visibleBoundaries]` that computes the URL params
- [ ] Compare against defaults — only include params when state differs from defaults
- [ ] Call `window.history.replaceState()` with the updated URL (preserving other existing params like `tab`, `poi`)

### Phase 3: Handle edge cases

- [ ] "Show all" / "Hide all" buttons (Map.jsx) trigger `setVisibleTypes` → URL updates automatically
- [ ] Boundary "All" / "None" buttons trigger `setVisibleBoundaries` → URL updates automatically
- [ ] When a shared URL includes both `?poi=` and `?types=`, both work independently
- [ ] Invalid type names in URL are silently ignored (intersection with known types)
- [ ] Invalid boundary IDs in URL are silently ignored

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/App.jsx` | Parse URL params, store in refs, override init effects, add sync-to-URL effect |

No new files needed. No backend changes. No database migrations.

---

## Testing Strategy

### Manual Testing

1. Open `/?types=trail,historic` → verify only trail and historic POIs shown
2. Open `/?boundaries=<CVNP_ID>` → verify only CVNP boundary shown
3. Toggle a POI type in legend → verify URL updates in address bar
4. Toggle a boundary → verify URL updates
5. Copy URL → open in new tab → verify same filter state
6. Open `/?types=trail&poi=stanford-hostel` → verify both POI deep-link and filter work
7. Open clean `/` → verify default behavior (no params in URL)
8. Open `/?types=nonexistent` → verify graceful handling (empty map, no crash)
9. Click "All" / "None" on POI types → verify URL updates
10. Click "All" / "None" on boundary sections → verify URL updates

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| URL gets very long with many types | Low | Only include params when state differs from defaults |
| Race between URL parse and data fetch | Med | Use refs consumed by init effects — they run after data arrives |
| Breaking existing `?poi=` or `?tab=` params | High | Preserve all existing params, only add/remove `types`/`boundaries` |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-06-24 | Initial plan |
