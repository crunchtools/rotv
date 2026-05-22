# Specification: POI Frontend Unification

> **Spec ID:** 020-poi-frontend-unification
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-21

## Overview

The backend was already unified into a single role-based model (spec [005-poi-roles](../005-poi-roles/spec.md)): one `pois` table, a `poi_roles` array as the source of truth, and geometry-driven rendering. The frontend never followed. It still carries the old split model — separate `selectedDestination` / `selectedLinearFeature` / `linearFeatures` state, three parallel data fetches, `isLinearFeature` / `isVirtual` derived flags, and a 3,643-line `Sidebar.jsx` with 93 type conditionals. This refactor collapses the frontend onto a single role-based POI model so shared logic lives in one place, paying down the debt described in issue #184.

This is a **refactor with no user-visible behavior change** (PATCH). Every existing feature must work identically after the change.

---

## User Stories

### Data Model (Frontend State)

**US-020-01: Single selected-POI state**
> As a developer, I want one `selectedPoi` state value instead of parallel `selectedDestination` / `selectedLinearFeature` so that selection logic is not duplicated across App, Map, and Sidebar.

Acceptance Criteria:
- [ ] `App.jsx` holds a single `selectedPoi` (replacing `selectedDestination` + `selectedLinearFeature`)
- [ ] `Map.jsx` receives one selected-POI prop and one `onSelectPoi` callback
- [ ] `Sidebar.jsx` receives one `poi` prop (replacing `destination` + `linearFeature`)
- [ ] URL/permalink load and back-button behavior are preserved exactly

**US-020-02: Single POI collection**
> As a developer, I want one POI list in frontend state instead of separate `destinations`, `linearFeatures`, and organization arrays so that there is one source of truth matching the backend.

Acceptance Criteria:
- [ ] Frontend holds a single POI collection (or clearly-derived views of one collection)
- [ ] All map layers (markers, paths, boundaries, organizations) derive from that collection
- [ ] No regression in which POIs are visible per zoom / filter / tab

### Rendering

**US-020-03: Geometry-driven rendering**
> As a developer, I want map rendering decided by geometry shape, not by a type/role flag, matching backend NFR-005-02.

Acceptance Criteria:
- [ ] `Point` geometry → marker; `LineString`/`MultiLineString` → path; `Polygon`/`MultiPolygon` → area overlay
- [ ] A POI with no geometry is never rendered on the map (organization-only POIs)
- [ ] `isLinearFeature` / `isVirtual` boolean derivations are removed in favor of geometry checks and `poi_roles.includes(...)`

**US-020-04: Role-driven content, not type-driven**
> As a developer, I want sidebar content sections gated on `poi_roles` (via `.includes()`) rather than `feature_type` / derived type flags, matching the dual-role lesson from PR #348.

Acceptance Criteria:
- [ ] All sidebar conditionals branch on `poi_roles.includes('...')` or geometry, never on `poi_roles[1]` / `feature_type`
- [ ] Dual-role POIs (e.g. boundary + organization) show the correct combined content

### Component Structure

**US-020-05: Modular Sidebar**
> As a developer, I want the monolithic `Sidebar.jsx` split into focused files so that shared logic (media, tabs, save, events) is defined once.

Acceptance Criteria:
- [ ] `Sidebar.jsx` reduced to a container that composes sub-components
- [ ] Already-inlined components (`ReadOnlyView`, `EditView`, `PoiNews`, `PoiEvents`, `AssociationsModal`, `AssociationsTabContent`, `TrailStatus`, `ShareModal`) extracted into their own files
- [ ] Shared media handling extracted into a reusable hook (`usePoiMedia` or equivalent) used by all POI content paths
- [ ] No duplicated media/tab/save logic across POI content paths

---

## Data Model

No database changes. The backend `pois` schema and `poi_roles` array (spec 005) are unchanged. This refactor is frontend-only.

### Frontend State Shape (target)

```
selectedPoi: Poi | null          // replaces selectedDestination + selectedLinearFeature
pois: Poi[]                       // single collection; derived views by role/geometry as needed
```

Where a `Poi` carries at minimum: `id`, `name`, `poi_roles: string[]`, `geometry` (GeoJSON or null), `latitude`/`longitude` (point convenience), plus existing descriptive fields.

---

## API Endpoints

No new or modified endpoints required for the core refactor.

**Current state:** the frontend makes three POI fetches (`App.jsx`):
- `GET /api/destinations`
- `GET /api/linear-features`
- `GET /api/pois?role=organization`

All three read the same unified `pois` table.

**Decision (resolved):** keep the three existing endpoints and merge their results into one frontend collection client-side. This keeps the refactor strictly frontend with zero API/backend risk. Endpoint consolidation into a single `GET /api/pois` is deferred to a future task.

---

## UI/UX Requirements

**No visible change.** This is the primary acceptance gate: every screen, tab, map layer, edit form, and permalink must behave identically before and after.

### Components (target structure)

- `Sidebar.jsx` — container/composition only
- `sidebar/ReadOnlyView.jsx`, `sidebar/EditView.jsx`, `sidebar/PoiNews.jsx`, `sidebar/PoiEvents.jsx`, `sidebar/AssociationsModal.jsx`, `sidebar/AssociationsTabContent.jsx`, `sidebar/TrailStatus.jsx`, `sidebar/ShareModal.jsx` (exact file layout decided in plan)
- `hooks/usePoiMedia.js` (or equivalent) — shared media state/operations

---

## Non-Functional Requirements

**NFR-020-01: Behavior parity**
- No user-visible behavior change. Verified by manual browser walkthrough of all POI types (point destination, trail/linear, organization-only, dual-role boundary+org) plus permalink load, edit mode, media, news/events tabs, associations, and MTB mode.

**NFR-020-02: Role/geometry checks only**
- No new code may branch on `feature_type` or `poi_roles[index]`. Use `poi_roles.includes(...)` and geometry-shape checks, per the PR #348 lesson.

**NFR-020-03: Incremental & reversible**
- Delivered in phases that each build and pass tests, so the refactor can be paused/verified between steps rather than as one big-bang merge.

**NFR-020-04: No backend changes**
- Database schema, migrations, and API contracts are untouched (unless the plan explicitly elects the optional endpoint consolidation, which would be called out separately).

---

## Dependencies

- Depends on: [005-poi-roles](../005-poi-roles/spec.md) (backend role model — already implemented)
- Closes: GitHub issue #184 (frontend portion; backend Phase 1 already complete)

---

## Resolved Decisions

1. **Data fetch:** Keep the three endpoints, merge client-side into one frontend collection. No backend change.
2. **Phasing:** Top-down — unify `App.jsx`/`Map.jsx` `selectedPoi` state and the POI collection first, then refactor `Sidebar.jsx` into modules.

## Open Questions

1. Sub-component file layout: a `sidebar/` subdirectory vs. flat `components/`? (Decide in plan.)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-21 | Initial draft |
