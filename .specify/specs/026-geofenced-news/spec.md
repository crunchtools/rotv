# Specification: GeoFenced and Associated News & Events

> **Spec ID:** 026-geofenced-news
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-27

## Overview

When a user clicks a geographic boundary (e.g. Sand Run) or an organization (e.g.
Summit County Metro Parks), the News and Events sub-tabs should show content for
everything that boundary contains or that organization owns — not just content
collected against that single POI. This rolls up the news/events that already
exist on the contained/owned POIs so a park or org page becomes a true digest of
its area, with each item labeled by the POI it came from.

Closes #406.

---

## User Stories

### Geo-fenced rollup

**US-026-1: News & events for everything inside a boundary**
> As a visitor, I want to click a park boundary like Sand Run and see all of the
> News and Events for every point of interest contained within that park, so that
> I get one consolidated view of what's happening in the park.

Acceptance Criteria:
- [ ] Clicking a boundary POI shows news/events whose owning POI's location falls
      inside that boundary's polygon (`ST_Contains`), plus any collected against
      the boundary itself.
- [ ] Applies to all boundary types (park, municipal, county, state).
- [ ] Each rolled-up item shows the name of the POI it came from.
- [ ] The News/Events tabs appear for a boundary that has rolled-up content even
      if the boundary POI itself has none.

### Organization rollup

**US-026-2: News & events for everything an organization owns**
> As a visitor, I want to click an organization like Summit County Metro Parks and
> see news for every park and point of interest within those parks, so that I can
> follow an entire agency from one place.

Acceptance Criteria:
- [ ] Clicking an organization POI shows its own news/events, plus content from
      POIs it owns (`owner_id`) or is associated with (`poi_associations`), plus
      content from POIs geographically contained within any park boundary it owns.
- [ ] Each rolled-up item shows the name of the POI it came from.
- [ ] Tabs appear when the org has rolled-up content even with none of its own.

### Navigation integrity

**US-026-3: Rolled-up items link to their own POI's permalink**
> As a visitor, I want clicking a rolled-up news/event item to open that item's
> real detail page, so that the "read more" / permalink works.

Acceptance Criteria:
- [ ] Clicking a rolled-up item navigates to `/{sourcePoiSlug}/{news|events}/{titleSlug}`
      (the item's owning POI), not the boundary/org slug.

---

## Data Model

No schema changes. Uses existing structures:

| Structure | Role |
|-----------|------|
| `pois.poi_roles` | distinguishes `boundary` / `organization` / `point` targets |
| `pois.boundary_geom` | polygon used for `ST_Contains` containment |
| `pois.geom` / `pois.geometry` | POI point used as containment test point |
| `pois.owner_id` | direct org ownership FK |
| `poi_associations(virtual_poi_id, physical_poi_id)` | org ↔ POI association |
| `poi_news.poi_id` / `poi_events.poi_id` | one-to-one item → POI link (unchanged) |

---

## API Endpoints

No new endpoints. Three existing endpoints gain rollup behavior when the target
POI is a boundary or organization (regular point POIs are unchanged):

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/pois/:id/news` | Returns news for the expanded POI-id set; adds `poi_id` + `poi_name` per item |
| GET | `/api/pois/:id/events` | Returns events for the expanded POI-id set; adds `poi_id` + `poi_name` per item |
| GET | `/api/pois/:id/tab-counts` | Counts over the expanded POI-id set |

Expansion is automatic and role-driven — no new query parameter.

---

## UI/UX Requirements

- `PoiNews` / `PoiEvents`: when an item's `poi_id` differs from the page POI,
  render a small source-POI label (the originating POI name) on the item.
- Clicks use the item's source POI name to build the permalink slug.

---

## Non-Functional Requirements

**NFR-026-1: Graceful PostGIS fallback**
- If a spatial query fails (PostGIS unavailable), rollup degrades to the
  non-spatial expansion (org's own + owned/associated) and never errors the
  endpoint — mirrors `getContainingBoundaries`' existing fallback.

**NFR-026-2: No regression for point POIs**
- A regular point POI's endpoints behave exactly as today (id set is just `[id]`),
  paying no spatial-query cost.

---

## Dependencies

- Depends on: PostGIS support (migration 021) and boundary geometry (spec 005 /
  issue #198 imports). Builds on the same `ST_Contains` pattern as
  `backend/services/geoService.js`.

---

## Open Questions

None — scope decisions resolved: all boundary types roll up; org rollup includes
POIs inside owned parks; rolled-up items are labeled with their source POI.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-27 | Initial draft |
