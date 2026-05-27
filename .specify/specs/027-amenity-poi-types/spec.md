# Specification: Playground & Restroom Amenity POI Types

> **Spec ID:** 027-amenity-poi-types
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-27

## Overview

Parents want to find parks with good playgrounds and restrooms. This adds
**Playground** and **Restroom** as first-class map POI types (filterable legend
entries), seeds real locations inside our park boundaries from OpenStreetMap, and
excludes these amenity types from news/events collection (they have no news and
collecting for them wastes API budget).

Closes #418.

## User Stories

### Find amenities

**US-027-1: Filter the map for playgrounds & restrooms**
> As a parent, I want Playground and Restroom to appear as their own toggleable
> types in the map legend so I can see which parks have them.

Acceptance Criteria:
- [ ] `playground` and `restroom` appear as POI types in the legend with distinct icons.
- [ ] Toggling them shows/hides those markers like any other type.
- [ ] A POI named "… Playground"/"… Restroom" (or with `primary_activities`
      Playground/Restroom) renders with the correct icon.
- [ ] Works for anonymous visitors (legend reads public `/api/admin/icons`).

**US-027-2: Real amenity locations inside parks**
> As a parent, I want actual playground and restroom locations shown inside the
> parks, sourced from OpenStreetMap.

Acceptance Criteria:
- [ ] Playgrounds (`leisure=playground`) and restrooms (`amenity=toilets`) that
      fall inside an existing **park** boundary are imported as point POIs
      (~240 features across 42 parks).
- [ ] Each is named from its OSM `name` tag, else `"<Park> Playground/Restroom"`
      (numeric suffix on collision within a park).
- [ ] Import is idempotent — re-running creates no duplicates (keyed on OSM id).

### Don't waste collection budget

**US-027-3: Skip news/events collection for amenity types**
> As an operator, I want news/events collection to skip playground and restroom
> POIs so we don't spend API budget on POIs that never have news.

Acceptance Criteria:
- [ ] Batch collection (all-POIs and per-tier) excludes POIs classified as an
      excluded type.
- [ ] The excluded type set is admin-configurable (`news_collection_excluded_types`),
      defaulting to `["playground","restroom"]`.
- [ ] News/Events tabs naturally stay hidden for these POIs (0 counts).

## Data Model

### Schema Changes

```sql
-- Provenance + idempotency key for OSM-sourced POIs
ALTER TABLE pois ADD COLUMN IF NOT EXISTS osm_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_osm_id ON pois (osm_id) WHERE osm_id IS NOT NULL;

-- New map types (filterable legend entries, keyword/activity classified)
INSERT INTO icons (name, label, svg_filename, title_keywords, activity_fallbacks, sort_order) VALUES
  ('playground', 'Playground', 'playground.svg', 'playground,play area', 'Playground', 19),
  ('restroom',   'Restroom',   'restroom.svg',   'restroom,restrooms,bathroom,toilet,toilets', 'Restroom', 20)
ON CONFLICT (name) DO NOTHING;

-- Default excluded-from-collection types
INSERT INTO admin_settings (key, value) VALUES
  ('news_collection_excluded_types', '["playground","restroom"]')
ON CONFLICT (key) DO NOTHING;
```

`pois.geom` and the icons/legend system are otherwise unchanged.

## API Endpoints

No new endpoints. Existing `/api/admin/icons` (public GET) surfaces the new types
to the map legend automatically.

## UI/UX Requirements

No new components. The legend is generated from `iconConfig`, so the two new icon
rows appear and filter automatically. Two new 32×32 SVGs in
`frontend/public/icons/` (`playground.svg`, `restroom.svg`) matching the existing
circle-badge style.

## Non-Functional Requirements

**NFR-027-1: Idempotent import** — re-running the OSM importer (or re-deploying)
must not duplicate POIs; keyed on `osm_id`.

**NFR-027-2: Reproducible data** — the OSM snapshot is committed
(`backend/data/osm/amenities.json`); the importer is deterministic and needs no
network at deploy time.

**NFR-027-3: No regression** — non-amenity POIs collect news/events exactly as
before; only excluded types are dropped from batch selection.

## Dependencies

- Builds on the icons/legend system (migration 065) and park boundaries (#198, 044).
- OSM data: Overpass API `leisure=playground` + `amenity=toilets`, filtered to
  features inside `boundary_type='park'` polygons.

## Open Questions

None — model (icons-table types), collection skip (by type), and data scope
(OSM import, park-contained) resolved.

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-27 | Initial draft |
