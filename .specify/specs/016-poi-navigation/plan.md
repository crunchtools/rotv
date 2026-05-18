# Implementation Plan: POI Navigation

> **Spec ID:** 016-poi-navigation
> **Status:** Planning
> **Last Updated:** 2026-05-18
> **Estimated Effort:** M (~150 LOC across migration, backend allowlists, frontend component + edit fields)

## Summary

Add a `NavigateButton` component that builds a Google Maps URL from a list of `{lat,lng}` stops. Wire it into the POI Info badge row next to Share — for destinations, MTB trailheads, organizations (when coords exist), and trails (NOT rivers/boundaries). Add nullable `navigation_latitude`/`navigation_longitude` columns to `pois` so admins can override the navigation target. Single new migration; small extensions to two admin allowlists and the public SELECTs; small admin UI additions.

---

## Architecture

### Component Diagram

```
┌────────────────── Sidebar.jsx ─────────────────────────────┐
│                                                            │
│  ReadOnlyView (destinations + organizations)               │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  <div className="badges-row">                        │ │
│  │    ... [Share] [NavigateButton  ◄── NEW]             │ │
│  │  </div>                                              │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  LinearFeature view (trails only — NOT rivers/boundaries)  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  ... [Share] [NavigateButton  ◄── NEW]               │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  EditView                                                  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Latitude  / Longitude                               │ │
│  │  Navigation Latitude / Navigation Longitude  ◄── NEW │ │
│  │  (helper text)                                       │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
└────────────────────────────────────────────────────────────┘

      ┌─────────────── NavigateButton.jsx (NEW) ──────────────┐
      │                                                       │
      │   props: { stops: [{lat, lng}], label?, className? }  │
      │                                                       │
      │   buildGoogleMapsUrl(stops) (named export, testable)  │
      │                                                       │
      │   onClick → window.open(url, '_blank', ...)           │
      └───────────────────────────────────────────────────────┘
```

### Stop Selection Logic (per POI type)

| POI type                              | navigation_lat/lng set? | Use                                 |
|---------------------------------------|-------------------------|-------------------------------------|
| Destination, MTB, organization (point)| Yes                     | `[navigation_lat, navigation_lng]`  |
| Destination, MTB, organization (point)| No                      | `[latitude, longitude]` (if both)   |
| Trail                                 | Yes                     | `[navigation_lat, navigation_lng]`  |
| Trail                                 | No, has geometry        | First coord of `geometry.coordinates` |
| Trail                                 | No, no geometry         | Badge hidden                        |
| River                                 | Yes                     | `[navigation_lat, navigation_lng]`  |
| River                                 | No                      | Badge hidden                        |
| Boundary                              | Yes                     | `[navigation_lat, navigation_lng]`  |
| Boundary                              | No                      | Badge hidden                        |

(Rivers/boundaries can opt in by setting the override; without it they stay hidden — matches Design Notes in the spec.)

### Google Maps URL Format

Single stop:
```
https://www.google.com/maps/dir/?api=1&destination=LAT,LNG
```

Multi-stop (for future #366):
```
https://www.google.com/maps/dir/?api=1&origin=LAT0,LNG0&destination=LATN,LNGN&waypoints=LAT1,LNG1|LAT2,LNG2
```

(Single-stop omits `origin` so Google Maps uses the user's current location.)

---

## Technology Choices

| Component            | Technology                       | Rationale                                            |
|----------------------|----------------------------------|------------------------------------------------------|
| Migration            | Plain SQL (`053_*.sql`)          | Matches existing migration convention                |
| URL builder          | Plain JS                         | No dependency; easy unit test                        |
| Button render        | React functional component       | Matches existing ShareButton/share-badge-btn         |
| Icon                 | Inline SVG (direction arrow)     | Same pattern as other badges                         |
| Window open          | `window.open(url, '_blank', ...)`| Standard browser intent — Google Maps handles rest   |

---

## Implementation Steps

### Phase 1: Migration + backend

- [ ] Create `backend/migrations/053_add_navigation_override.sql` with two `ADD COLUMN IF NOT EXISTS` statements
- [ ] In `backend/routes/admin.js`:
  - Add `'navigation_latitude'`, `'navigation_longitude'` to `allowedFields` in `PUT /pois/:id` (line ~165)
  - Add the same to `allowedFields` in `PUT /destinations/:id` (line ~222)
- [ ] In `backend/server.js`, add `p.navigation_latitude, p.navigation_longitude` to the SELECT clauses of:
  - `/api/destinations` (~line 1667)
  - `/api/destinations/:id` (~line 1691)
  - `/api/linear-features` (~line 1716)
  - `/api/linear-features/:id` (~line 1741)
  - any other public GET that returns POI rows used by the Sidebar (grep audit during implementation)

### Phase 2: Frontend component

- [ ] Create `frontend/src/components/NavigateButton.jsx`
  - Props: `stops` (required, array of `{lat, lng}`), `label` (default `'Navigate'`), `className` (default `'share-badge-btn'`)
  - Export `buildGoogleMapsUrl(stops)` as a named export for testing
  - Returns `null` if `stops` is empty or contains only invalid entries
- [ ] Create `frontend/src/utils/geo.js` with `firstGeometryPoint(geometry)` that returns `{lat, lng}` from a GeoJSON LineString or MultiLineString (returns `null` for missing/invalid geometry). Polygon is not used here.

### Phase 3: Sidebar wiring

- [ ] In `Sidebar.jsx`:
  - Import `NavigateButton` and `firstGeometryPoint`
  - Build a small helper `getNavigationStops(poi)` inside the file:
    - If `poi.navigation_latitude && poi.navigation_longitude` → return that
    - Else if `poi.latitude && poi.longitude` → return that
    - Else if poi has trail role and `poi.geometry` → return `firstGeometryPoint`
    - Else → `null`
  - In `ReadOnlyView` (line ~260, after the Share button): render `<NavigateButton>` if stops exist
  - In the LinearFeature view's badges-row: render `<NavigateButton>` **only if** the feature is a trail (`feature_type === 'trail'` or `poi_roles` contains `trail`) **or** it has a navigation override

### Phase 4: Admin edit fields

- [ ] In `Sidebar.jsx`'s `EditView`: add two number inputs for `navigation_latitude` and `navigation_longitude`, near the existing lat/lng fields
- [ ] Helper text: "Optional — Google Maps will navigate here instead of the main coordinates. Use the parking lot or visitor entrance if the main coordinates are off-road."
- [ ] Validation: if one is set the other must be too — flag a small inline error if mismatched

### Phase 5: Tests

- [ ] Unit tests in `frontend/src/components/NavigateButton.test.js`:
  - `buildGoogleMapsUrl([{lat: 41.2, lng: -81.5}])` → expected single-stop URL
  - `buildGoogleMapsUrl([{lat: 41.2, lng: -81.5}, {lat: 41.3, lng: -81.6}])` → uses `origin` + `destination`
  - `buildGoogleMapsUrl([{lat: 41.2, lng: -81.5}, {lat: 41.3, lng: -81.6}, {lat: 41.4, lng: -81.7}])` → uses `origin`, `destination`, `waypoints`
  - `buildGoogleMapsUrl([])` → `null`
  - `buildGoogleMapsUrl([{lat: null, lng: -81.5}])` → `null`
- [ ] Manual browser test on dev container (port 8085) — see Manual Testing below

---

## File Changes

### New Files

| File                                              | Purpose                                            |
|---------------------------------------------------|----------------------------------------------------|
| `backend/migrations/053_add_navigation_override.sql` | Add nullable navigation_latitude/longitude     |
| `frontend/src/components/NavigateButton.jsx`      | Badge component + `buildGoogleMapsUrl` helper      |
| `frontend/src/components/NavigateButton.test.js`  | Vitest unit tests                                  |
| `frontend/src/utils/geo.js`                       | `firstGeometryPoint(geometry)` helper              |

### Modified Files

| File                                          | Changes                                                                |
|-----------------------------------------------|------------------------------------------------------------------------|
| `backend/server.js`                           | Add `navigation_latitude`, `navigation_longitude` to relevant SELECTs |
| `backend/routes/admin.js`                     | Add the two columns to allowlists for `PUT /pois/:id` and `PUT /destinations/:id` |
| `frontend/src/components/Sidebar.jsx`         | Import NavigateButton; render in ReadOnlyView + LinearFeature view; add admin edit fields in EditView |

(No CSS changes — reusing `.share-badge-btn` class for consistent styling.)

---

## Database Migrations

`backend/migrations/053_add_navigation_override.sql`:

```sql
-- 053_add_navigation_override.sql
-- Add optional navigation override coordinates to POIs. When set, the frontend
-- Navigate button uses these instead of the primary latitude/longitude (or first
-- geometry coord for trails). Allows admins to pin navigation to a parking
-- entrance or visitor center when the POI's primary coords are off-road or
-- geographically arbitrary (rivers, boundaries).

ALTER TABLE pois ADD COLUMN IF NOT EXISTS navigation_latitude  DECIMAL(10, 8);
ALTER TABLE pois ADD COLUMN IF NOT EXISTS navigation_longitude DECIMAL(11, 8);
```

---

## API Implementation

No new endpoints. Existing endpoints extended:

**Modified: `PUT /api/admin/pois/:id`**

Adds `navigation_latitude`, `navigation_longitude` to the allowed-fields allowlist. Same input format as `latitude`/`longitude`.

**Modified: `PUT /api/admin/destinations/:id`**

Same change.

**Modified GET endpoints (response shape)**

All POI/destination/linear-feature GET endpoints now include two extra fields in each row:

```json
{
  "id": "...",
  "name": "...",
  "latitude": 41.2,
  "longitude": -81.5,
  "navigation_latitude": null,
  "navigation_longitude": null,
  ...
}
```

---

## Testing Strategy

### Unit Tests (Vitest)

- [ ] `NavigateButton.test.js` — see Phase 5 above

### Manual Testing

1. **Build + start** the feature container on port 8085 (`./run.sh build && ./run.sh start`).
2. **Destination POI**: Open a destination with lat/lng. Verify Navigate badge appears next to Share. Click → Google Maps opens with destination set.
3. **Trail**: Open a trail. Verify Navigate badge appears. Click → Google Maps opens at the trailhead (first coord of geometry).
4. **River**: Open a river. Verify Navigate badge does NOT appear.
5. **Boundary**: Open a boundary. Verify Navigate badge does NOT appear.
6. **Organization without coords**: Open an organization that has no lat/lng. Verify Navigate badge does NOT appear.
7. **Admin override**: As admin, open a POI in edit mode. Set `navigation_latitude` and `navigation_longitude` to known good coords (e.g., a specific parking lot). Save. Reload as a regular user. Click Navigate → Google Maps opens with the override coords, not the original.
8. **River with override**: Same as above, but on a river. Verify Navigate badge now appears (because override is set).
9. **Mobile**: Open on a mobile device (or Chrome mobile emulator). Click Navigate. Verify the Google Maps native app opens (if installed) with the destination.

---

## Rollback Plan

If issues are discovered after merge:

1. Revert the merge commit on master.
2. The migration is additive (nullable columns); leaving the columns in place is harmless. If we re-deploy a version without the migration, the columns just sit unused.
3. Re-tag the previous version.

---

## Risks and Mitigations

| Risk                                                    | Impact | Mitigation                                                                |
|---------------------------------------------------------|--------|---------------------------------------------------------------------------|
| Google changes Maps URL format                          | Low    | Documented public URL format, stable for years                            |
| Trail first-coord is the wrong end                      | Low-Med| Admin can set `navigation_*` override per-trail                           |
| Forgetting to add columns to a SELECT (omitted endpoint)| Med    | grep audit during implementation; tests touch the sidebar (which fetches via the affected endpoints) |
| Admin sets only one of nav_lat/nav_lng (data integrity) | Low    | Inline UI validation in EditView                                          |
| User on mobile without Google Maps app                  | Low    | URL falls back to web Google Maps automatically                           |

---

## Changelog

| Date       | Changes                                                                  |
|------------|--------------------------------------------------------------------------|
| 2026-05-18 | Initial plan; includes nav_lat/nav_lng override + admin UI               |
