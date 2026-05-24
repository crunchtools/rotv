# Specification: Cleveland Water Taxis

> **Spec ID:** 023-water-taxis
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-23

## Overview

Add the two water taxi services operating in the Cleveland Flats — the eLCee2 Metroparks Shuttle and the Harbor Hopper commercial taxi — to the map as a new transit layer. These services connect the East and West banks of the Cuyahoga and tell the "modern roots" story of river transit: the eLCee2 links the Towpath Trail across the water without using road bridges, and the Harbor Hopper mirrors the 1800s bumboat and ferry traffic that shuttled sailors and workers across the river. Routes render as dashed lines across the river, distinct from the solid river line and dashed trail lines already on the map.

---

## User Stories

### Map Exploration

**US-023-1: See water taxi routes on the map**
> As a map visitor, I want to see the water taxi routes drawn across the Cuyahoga so that I can understand how the East and West banks connect by water.

Acceptance Criteria:
- [ ] eLCee2 and Harbor Hopper appear as distinct dashed transit lines crossing the river in the Flats.
- [ ] A "Water Taxis" toggle in the legend shows/hides the transit layer independently of the Rivers and Trails layers.
- [ ] Clicking a route opens the POI sidebar with its name, description, and root note (historical connection).

**US-023-2: Understand seasonality**
> As a visitor planning a trip, I want to know the water taxis are seasonal so that I don't expect them to run in winter.

Acceptance Criteria:
- [ ] Each water taxi POI is flagged `is_seasonal = true`.
- [ ] The sidebar/popup clearly indicates the service is seasonal (does not run in winter).

**US-023-3: Check accessibility**
> As a visitor with mobility needs or a bike, I want to know which service is accessible so that I can choose the right one.

Acceptance Criteria:
- [ ] The eLCee2 is flagged as ADA-accessible and bike-friendly.
- [ ] Accessibility is surfaced in the sidebar/popup (e.g. ADA + bike-friendly badges).

### Live Tracking

**US-023-4: Track the boat live**
> As a visitor waiting for a ride, I want a link to the live GPS tracker so that I can see when the boat arrives.

Acceptance Criteria:
- [ ] A "Live Tracker" button appears in the sidebar/popup for services that have a tracker URL.
- [ ] The button opens the external GPS tracking app/site in a new tab (`rel="noopener noreferrer"`).
- [ ] Services without a tracker URL do not show the button.

---

## Data Model

### New Tables

None. Water taxis reuse the existing `pois` table (point marker + linear `geometry`, same pattern as `river`-role POIs).

### Schema Changes

```sql
-- Migration 062: water taxi support
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_seasonal       BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_ada_accessible BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_bike_friendly  BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS live_tracker_url  VARCHAR(500);
ALTER TABLE pois ADD COLUMN IF NOT EXISTS stops             JSONB;  -- [{name,lat,lng}] ordered transit stops
```

- New `poi_roles` value: `water_taxi` (rendered as a dashed transit line; toggled by the "Water Taxis" legend layer).
- Each service is one POI: a point marker at its primary East Bank dock plus a dashed `geometry` LineString (or MultiLineString for multi-stop Harbor Hopper) describing the transit path across the river.
- `live_tracker_url` holds the Harbor Hopper GPS app link; `more_info_link` continues to hold the general website.

---

## API Endpoints

No new endpoints. Water taxi POIs are served by the existing POI/linear-feature endpoints; the four new columns are added to the existing POI serializer so they reach the frontend.

---

## UI/UX Requirements

### Map / Legend

- New legend layer toggle **"Water Taxis"** alongside Trails and Rivers.
- `water_taxi`-role geometry styled as a dashed line (`dashArray`) in a transit color distinct from river blue (`#1E90FF`) and trail brown (`#8B4513`).

### Sidebar / Popup

- Seasonal indicator ("Seasonal — does not run in winter").
- ADA and bike-friendly badges when the respective flags are set.
- "Live Tracker" button when `live_tracker_url` is present.

### Imagery (follow-up)

Photos called for by the issue (East Bank dock signage; eLCee2 vs. Harbor Hopper vessel comparison) are uploaded through the existing `poi_media` gallery flow once captured. Not blocking on initial launch.

---

## Non-Functional Requirements

**NFR-023-1: Idempotent migration**
- Migration re-runs cleanly on every container start (`ADD COLUMN IF NOT EXISTS`).

**NFR-023-2: Graceful rendering**
- New columns default safely (false / null); existing POIs and the existing map are unaffected when the columns are empty.

**NFR-023-3: External link safety**
- Live Tracker links open in a new tab with `rel="noopener noreferrer"`.

---

## Dependencies

- Depends on: existing linear-feature rendering (river-role POIs, spec 022) and grouped legend layers (spec 015).
- Blocks: none.

---

## Open Questions

1. ~~**Geometry source/accuracy**~~ **RESOLVED:** Route geometry and stop locations come from OpenStreetMap `route=ferry` ways and `amenity=ferry_terminal` nodes (eLCee2: way 978606820 + East/West Bank docks; Harbor Hopper: ways 1417965570/71/72 chained, with stops Cleveland Water Taxi Main Hub, Flats East Bank, Collision Bend Brewing, BrewDog Outpost). Stops are stored in a new `pois.stops` JSONB column and rendered as labeled markers along the route.
2. ~~**One POI vs. one-per-stop**~~ **RESOLVED:** One POI per service carrying the full route geometry.
3. ~~**Live tracker URL**~~ **RESOLVED:** Harbor Hopper's live tracker is `https://trackmyshuttle.com/a/5799` (TrackMyShuttle, linked as "Taxi Tracker" from the official clevelandwatertaxi.com) — seeded in migration 062. eLCee2 is the free Cleveland Metroparks boat and has no commercial tracker, so its `live_tracker_url` stays NULL. The button is scheme-validated (http/https only) before rendering.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-23 | Initial draft |
