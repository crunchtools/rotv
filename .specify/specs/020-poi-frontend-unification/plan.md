# Implementation Plan: POI Frontend Unification

> **Spec ID:** 020-poi-frontend-unification
> **Status:** Planning
> **Last Updated:** 2026-05-21
> **Estimated Effort:** L

## Summary

Top-down frontend refactor. First collapse `App.jsx` parallel selection/collection
state onto a single `selectedPoi` + merged `pois` collection and push the result
through `Map.jsx` and `Sidebar.jsx`. Then break the 3,643-line `Sidebar.jsx` into
focused files with a shared media hook. No backend or API changes; no user-visible
behavior change.

---

## Architecture

### Current (split) data flow

```
App.jsx
  destinations[]  virtualPois[]  linearFeatures[]      <- 3 fetches, 3 arrays
  selectedDestination | selectedLinearFeature          <- 2 selection slots
        │                         │
        ▼                         ▼
  Map.jsx (selectedDestination, selectedLinearFeature, onSelectDestination, onSelectLinearFeature)
  Sidebar.jsx (destination, linearFeature)  -> 93 isLinearFeature/isVirtual/feature_type conditionals
```

### Target (unified) data flow

```
App.jsx
  pois[]            (merged from the 3 fetches, client-side)
  selectedPoi       (single slot; null = nothing selected)
        │
        ▼
  Map.jsx (pois, selectedPoi, onSelectPoi)   -> geometry-shape decides marker/path/overlay
  Sidebar.jsx (poi)  -> content gated on poi_roles.includes(...) and geometry
       composes:
         sidebar/ReadOnlyView, EditView, PoiNews, PoiEvents,
         AssociationsModal, AssociationsTabContent, TrailStatus, ShareModal
         hooks/usePoiMedia
```

### Key observation grounding the refactor

`selectedDestination` already holds points, organizations, **and** virtual POIs
(App.jsx:605/617). The only live binary is destination-vs-linear, and almost every
setter is a paired `setSelectedX(v); setSelectedY(null)`. Collapsing to one
`selectedPoi` is therefore largely mechanical at the App layer.

---

## Implementation Steps

### Phase A: App.jsx state unification (highest risk, done first)

- [ ] Add a memoized `pois` collection merging `destinations`, `virtualPois`, `linearFeatures` (dedupe by `id`; keep existing arrays as the fetch targets and as `Map` layer inputs for now to limit blast radius).
- [ ] Introduce `selectedPoi` / `setSelectedPoi`. Replace every `setSelectedDestination(x); setSelectedLinearFeature(null)` pair with `setSelectedPoi(x)` and every paired-null with `setSelectedPoi(null)`.
- [ ] Replace slug-resolution lookups (initial load, URL effect, MTB nav) to search the merged `pois` collection once instead of three sequential `.find()` calls.
- [ ] Provide compatibility derivations at the Map/Sidebar prop boundary so downstream still receives what it expects until Phases B/C land: `selectedDestination = hasLineGeometry(selectedPoi) ? null : selectedPoi`, `selectedLinearFeature = hasLineGeometry(selectedPoi) ? selectedPoi : null`. This lets Phase A merge and verify without touching Map/Sidebar internals.
- [ ] Build + verify behavior parity before moving on.

### Phase B: Map.jsx geometry-driven props

- [ ] Change `Map` to accept `selectedPoi` + `onSelectPoi` (keep a thin internal split if needed for Leaflet layer code, derived from geometry shape, not from a type flag).
- [ ] Replace `selectedDestination`/`selectedLinearFeature` internal usages with geometry-shape checks (`Point` → marker selection, `LineString`/`MultiLineString` → path selection).
- [ ] Remove `isLinearFeature`/`feature_type` derivations in Map.jsx (12 occurrences).
- [ ] Build + verify map selection, fly-to, boundaries, MTB highlight.

### Phase C: Sidebar.jsx unification + modularization

- [ ] Change `Sidebar` to a single `poi` prop; derive `isLinearFeature`/`isVirtual` locally **only** as transitional shims, then eliminate by converting each conditional to `poi.poi_roles?.includes(...)` or a geometry check.
- [ ] Extract inlined components into files (layout decided below): `ReadOnlyView`, `EditView`, `PoiNews`, `PoiEvents`, `AssociationsModal`, `AssociationsTabContent`, `TrailStatus`, `ShareModal`, plus small helpers (`CellSignal`, `getNavigationStops`, etc.).
- [ ] Extract shared media state/handlers into `hooks/usePoiMedia.js`; replace the duplicated `handleMediaUpdate` + media event-listener logic across paths.
- [ ] Reduce `Sidebar.jsx` to a container that wires props → hooks → sub-components.
- [ ] Build + verify every tab/path for each POI shape.

### Phase D: Cleanup

- [ ] Remove now-dead `selectedDestination`/`selectedLinearFeature` props/derivations across the three files.
- [ ] Grep-confirm no remaining `feature_type` or `poi_roles[<index>]` branches (NFR-020-02).
- [ ] Update any affected Playwright/Vitest selectors.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/hooks/usePoiMedia.js` | Shared media state + event handling for all POI content paths |
| `frontend/src/components/sidebar/ReadOnlyView.jsx` | Extracted from Sidebar.jsx |
| `frontend/src/components/sidebar/EditView.jsx` | Extracted from Sidebar.jsx |
| `frontend/src/components/sidebar/PoiNews.jsx` | Extracted from Sidebar.jsx |
| `frontend/src/components/sidebar/PoiEvents.jsx` | Extracted from Sidebar.jsx |
| `frontend/src/components/sidebar/AssociationsModal.jsx` | Extracted from Sidebar.jsx |
| `frontend/src/components/sidebar/AssociationsTabContent.jsx` | Extracted from Sidebar.jsx |
| `frontend/src/components/sidebar/TrailStatus.jsx` | Extracted from Sidebar.jsx |
| `frontend/src/components/sidebar/ShareModal.jsx` | Extracted from Sidebar.jsx |

(Exact `sidebar/` subdirectory vs flat layout = Open Question 1; subdirectory is the default.)

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/App.jsx` | Merged `pois` collection; single `selectedPoi`; unified slug lookups; updated `<Map>`/`<Sidebar>` props |
| `frontend/src/components/Map.jsx` | `selectedPoi`/`onSelectPoi`; geometry-driven selection; remove type-flag derivations |
| `frontend/src/components/Sidebar.jsx` | Single `poi` prop; conditionals → `poi_roles.includes()`/geometry; reduced to container composing sub-components |

---

## Database Migrations

None. Frontend-only refactor.

## API Implementation

None. The three existing endpoints (`/api/destinations`, `/api/linear-features`, `/api/pois?role=organization`) are unchanged; results merged client-side.

---

## Testing Strategy

### Automated

- [ ] Existing Vitest + Playwright suites must pass unchanged (`./run.sh test`, run by `/deploy` after merge).
- [ ] Add a small unit test for the merge/dedupe helper if extracted as a pure function.

### Manual (behavior-parity gate, NFR-020-01)

Verify identical behavior before/after for each POI shape:
1. Point destination — select from map + from results list + via permalink
2. Trail / linear feature — select, fly-to, path highlight
3. Organization-only POI (no geometry) — not on map, opens from organizations list
4. Dual-role boundary+organization (e.g. City of Akron) — correct combined content
5. Edit mode — save/cancel/delete, coordinate preview, image upload/media
6. News + Events tabs, Associations modal/drawing
7. MTB mode — list, prev/next navigation, back-to-list
8. Back button + permalink round-trips

---

## Rollback Plan

1. Each phase is an independent commit that builds and verifies; revert the offending commit.
2. Worst case, revert the whole branch — backend and DB are untouched, so no data risk.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| URL/permalink + back-button regressions (the most fragile area) | High | Phase A keeps compatibility derivations; manual round-trip testing in the parity gate |
| MTB navigation relies on point-vs-linear distinction | Med | Replace with `poi_roles.includes('point')` + geometry, mirroring existing logic at App.jsx:2227 |
| Hidden coupling in Sidebar's 83 hooks/effects during extraction | Med | Extract bottom-up within Phase C, building after each component move |
| Leaflet layer code assumes separate arrays | Med | Phase B keeps internal geometry-derived split; don't rewrite layer rendering wholesale |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-21 | Initial plan |
