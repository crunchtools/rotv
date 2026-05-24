# Implementation Plan: Cleveland Water Taxis

> **Spec ID:** 023-water-taxis
> **Status:** Planning
> **Last Updated:** 2026-05-23
> **Estimated Effort:** M

## Summary

Add a `water_taxi` POI role and four generic POI columns (seasonal, ADA, bike-friendly, live-tracker URL), seed the two Flats water taxi services as POIs with dashed route geometry, and extend the map legend + linear-feature styling + sidebar to render them. No new tables or endpoints — reuses the river-role linear-feature pattern.

---

## Architecture

### Data Flow

1. Migration `062_add_water_taxis.sql` adds the four columns, seeds the two POIs, **and loads their route `geometry` inline** (idempotent).
2. The `/api/linear-features` serializer returns the new columns and includes the `water_taxi` role; the map fetches it as today.
3. `Map.jsx` styles `water_taxi`-role geometry as a dashed transit line and adds a "Water Taxis" legend toggle.
4. The sidebar reads the new columns to render seasonal/accessibility badges and the Live Tracker button.

### Geometry loading decision

The river feature uses a separate `load-river-geometry.js` script (its OSM geometries are large KB-scale MultiLineStrings) run manually at deploy. We instead embed the two small water taxi LineStrings directly in the SQL migration because: (a) the geometry is tiny (7 and 12 points), and (b) the dev (`entrypoint.sh`, unix-socket) and prod (`rotv-init.sh`, systemd) startup paths run only the numbered `*.sql` migrations and connect differently — a JS loader would need wiring into both and would not run on a plain `run.sh start`. Embedding in SQL gives one source of truth that loads automatically everywhere, with no manual deploy step. Coordinates are sampled from the Cuyahoga River centerline already in the DB so the lines sit on the water.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Route geometry | `pois.geometry` JSONB (GeoJSON LineString) | Same column/path the map already renders for river POIs |
| Role/layer model | `poi_roles[]` + legend layer toggle | Matches Trails/Rivers layers exactly |
| Accessibility/seasonal | Boolean POI columns | Generic, reusable beyond water taxis |

---

## Implementation Steps

### Phase 1: Backend / data
- [x] `backend/migrations/062_add_water_taxis.sql` — add 4 columns; seed eLCee2 + Harbor Hopper POIs with `water_taxi` role, descriptions, root notes, seasonal/accessibility flags, live_tracker_url; load route geometry inline (see Geometry loading decision).
- [x] Add the 4 new columns to `/api/linear-features` and include `water_taxi` in its role filter.

### Phase 2: Frontend rendering
- [x] Add `water_taxi` styling branch in `Map.jsx` `getLinearFeatureStyle` (dashed line, transit color `#0E9E9E`).
- [x] Add a "Water Taxis" layer toggle to the legend (`showWaterTaxis` state + handler), and include `water_taxi` in the visibility predicate.
- [x] Add the `water-taxis` layer icon asset (`frontend/public/icons/layers/water-taxis.svg`). Layer icons render from `/icons/layers/<id>.svg`, so no `iconUtils.js` change is needed.

### Phase 3: Sidebar
- [ ] Seasonal indicator + ADA / bike-friendly badges in the read-only sidebar view.
- [ ] "Live Tracker" button (external link, new tab) when `live_tracker_url` is set.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/062_add_water_taxis.sql` | Columns + POI seed + inline route geometry |
| `frontend/public/icons/layers/water-taxis.svg` | "Water Taxis" legend layer icon |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | `/api/linear-features` includes `water_taxi` role + new columns (also added to `/api/pois`) |
| `frontend/src/components/Map.jsx` | `water_taxi` style branch + "Water Taxis" legend toggle + visibility wiring |
| `frontend/src/App.jsx` | `showWaterTaxis` state/props; deep-link layer enable |
| `frontend/src/App.css` | `water-taxi` badge + `service-badge` (seasonal/ADA/bike) styles |
| `frontend/src/components/sidebar/ReadOnlyView.jsx` | Water Taxi/Seasonal/ADA/bike badges + scheme-validated Live Tracker button |

---

## Database Migrations

```sql
-- Migration: 062_add_water_taxis
-- Description: Water taxi columns + seed eLCee2 and Harbor Hopper POIs. Idempotent.

ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_seasonal       BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_ada_accessible BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS is_bike_friendly  BOOLEAN DEFAULT FALSE;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS live_tracker_url  VARCHAR(500);

-- Seed services guarded by NOT EXISTS on (name, 'water_taxi' = ANY(poi_roles)).
```

---

## Testing Strategy

### Manual Testing
1. Start the container; confirm migration runs and the two POIs exist with `water_taxi` role.
2. On the map, toggle "Water Taxis" — dashed routes appear/disappear across the river in the Flats.
3. Click a route — sidebar shows description, root note, seasonal indicator, accessibility badges (eLCee2: ADA + bike), and Live Tracker button (Harbor Hopper).
4. Confirm Rivers/Trails layers are unaffected.

### Automated
- [ ] Extend existing Playwright/map smoke coverage to assert the Water Taxis toggle renders, if a low-cost assertion fits the existing suite.

---

## Rollback Plan

1. New columns are additive and default-safe; leaving them in place is harmless.
2. To remove the feature: soft-delete the two seeded POIs (`deleted = true`) — routes vanish from the map without schema changes.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Route coordinates are approximate / wrong | Med | Snap coordinates to the Cuyahoga River LineString already in the DB so points sit on the water; verify visually before launch; easy to re-run geometry loader |
| Real photos not yet available | Low | Imagery is a non-blocking follow-up via existing gallery upload |
| Live tracker URL unknown/changes | Low | Button only renders when URL set; safe to leave null |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-23 | Initial plan |
