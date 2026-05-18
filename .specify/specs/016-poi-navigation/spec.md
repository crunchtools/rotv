# Specification: POI Navigation

> **Spec ID:** 016-poi-navigation
> **Status:** Draft
> **Version:** 0.2.0
> **Author:** Scott McCarty
> **Date:** 2026-05-18
> **GitHub Issue:** [#365](https://github.com/crunchtools/rotv/issues/365)
> **Related (future):** [#366 Advanced Google Maps Navigation](https://github.com/crunchtools/rotv/issues/366)

## Overview

Add a "Navigate" badge to the POI Info tab's badge row, next to the existing Share badge. Tapping it opens Google Maps (native app on mobile via intent URL, web on desktop) with the POI as the destination. Each POI may optionally specify a `navigation_latitude`/`navigation_longitude` override so admins can pin the navigation target to a parking entrance or visitor center when the POI's primary coordinates are off-road or geographically arbitrary (e.g., the middle of a river).

This is Phase 1 of the ROTV UX 1.0 plan (memory: UX 1.0 / issue #141) and the foundation for future multi-stop day-trip planning (#366).

---

## User Stories

### Point POIs (Destinations, MTB Trailheads, Organizations)

**US-016-1: Navigate to a destination**
> As a visitor browsing ROTV, I want to tap a "Navigate" badge on a POI's Info tab so that Google Maps opens with turn-by-turn directions to that location.

Acceptance Criteria:
- [ ] A "Navigate" badge appears in the badge row of the POI Info tab, next to the Share badge
- [ ] Tapping the badge opens Google Maps with the POI as destination
- [ ] On mobile (iOS/Android), the Google Maps native app opens if installed; web falls back otherwise
- [ ] The badge is hidden for POIs with no `latitude`/`longitude` and no `navigation_latitude`/`navigation_longitude` (e.g., abstract organizations)

### Linear Features (Trails)

**US-016-2: Navigate to a trail**
> As a hiker, I want to tap "Navigate" on a trail so that Google Maps opens directions to the trailhead.

Acceptance Criteria:
- [ ] The Navigate badge appears for trails (`poi_roles` containing `trail`)
- [ ] The destination is `navigation_latitude`/`navigation_longitude` if set, otherwise the first coordinate of the GeoJSON LineString geometry
- [ ] The badge is hidden if neither override nor geometry is available
- [ ] **Rivers and boundaries do NOT show the Navigate badge** — their first geometry point is not a meaningful entry location (see Design Notes)

### Admin Navigation Override

**US-016-3: Override navigation target for a POI**
> As an admin curating POI data, I want to set a separate "navigation" lat/lng for a POI so that visitors are routed to the parking lot or visitor center entrance instead of an off-road geometry point or the middle of a polygon.

Acceptance Criteria:
- [ ] Admin edit view exposes `navigation_latitude` and `navigation_longitude` fields for all POI types (destinations, MTB trailheads, organizations, trails)
- [ ] Both fields are nullable; when null, the frontend falls back to `latitude`/`longitude` (or first geometry coord for trails)
- [ ] When set, both must be valid coordinates; saving one without the other is rejected by the admin UI
- [ ] The admin UI explains the purpose: "Optional override — use the parking lot or visitor entrance if the POI's primary coordinates are off-road"

---

## Data Model

### Schema Changes

Migration `053_add_navigation_override.sql`:

```sql
ALTER TABLE pois ADD COLUMN IF NOT EXISTS navigation_latitude  DECIMAL(10, 8);
ALTER TABLE pois ADD COLUMN IF NOT EXISTS navigation_longitude DECIMAL(11, 8);
```

Both nullable. Existing rows have NULL — the frontend falls back to the existing `latitude`/`longitude` (or first geometry coord for trails) when NULL.

No new tables.

---

## API Endpoints

No new endpoints. Two existing admin endpoints add fields to their allowlists:

- `PUT /api/admin/pois/:id` — add `navigation_latitude`, `navigation_longitude`
- `PUT /api/admin/destinations/:id` — add `navigation_latitude`, `navigation_longitude`

Public GET endpoints (`/api/destinations`, `/api/destinations/:id`, `/api/linear-features`, `/api/linear-features/:id`, `/api/pois/*`) include the two new columns in their SELECT clauses so the frontend can read them.

---

## UI/UX Requirements

### New Components

- `NavigateButton` (`frontend/src/components/NavigateButton.jsx`) — renders the badge, accepts a list of stops, opens Google Maps. The component takes an **array of stops** from day one so #366 (multi-stop trip planning) can pass multiple POIs without changing the component interface.

### Placement

- **Destinations + organizations**: inside the `<div className="badges-row">` in `Sidebar.jsx`'s `ReadOnlyView` (line ~215), after the existing Share badge (line 260-267).
- **Trails**: inside the badges-row of the linear-feature view (the equivalent section for trails).
- **Rivers + boundaries**: explicitly not rendered.

### Visual Style

Matches the existing `.share-badge-btn` style — same height, padding, icon-with-label. Icon: small direction-arrow SVG (~14px). Label: "Navigate".

### Wireframe (text)

```
[Type] [Difficulty] [Era] [Owner] [Trail Status] [Source] [Share] [Navigate]
```

### Admin Edit View

In `Sidebar.jsx`'s `EditView`, add two number inputs labeled "Navigation Latitude (optional)" and "Navigation Longitude (optional)" near the existing lat/lng fields, with a small help text: "Override for Google Maps directions — use the parking entrance if the main coordinates are off-road."

---

## Non-Functional Requirements

**NFR-016-1: No backend round-trip at click time**
- Building the Google Maps URL is pure frontend logic. The button click does not call the ROTV API.

**NFR-016-2: Universal URL format**
- Use `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG` — Google's documented universal URL format. Opens the native app on mobile when installed; falls back to web. No platform sniffing.

**NFR-016-3: Extensible to multi-stop routes**
- The component takes an array of `{lat, lng}` stops. Single-stop is the basic case (#365); multi-stop is the future case (#366). Adding multi-stop later requires no changes to `NavigateButton`.

**NFR-016-4: Privacy**
- Tapping the badge sends the user to Google Maps; their device performs the navigation. ROTV never sees the user's location or destination beyond what's already public on the POI page.

---

## Design Notes

### Why hide Navigate on rivers and boundaries

Linear features with `feature_type = 'river'` or `feature_type = 'boundary'` have geometries whose first coordinate is geographically arbitrary — a river's first vertex is wherever the data import started, and a boundary polygon's first vertex is one corner of a region. Routing a user there would be misleading. If a specific river or boundary genuinely has a meaningful entry point (e.g., a park gate), an admin can set `navigation_latitude`/`navigation_longitude` on that POI — and the rendering rule for linear features will check for that override **before** deciding to render. Without the override, the badge stays hidden.

### How Google Maps handles off-road coordinates

Google Maps with raw `lat,lng` snaps the routed destination to the nearest drivable road and shows a final walking leg to the exact pin. For trailheads at parking lots this works perfectly. For deep off-road pins (well past any road network), Google Maps may show an approximate route. The override field exists to address that case explicitly when it matters.

---

## Dependencies

- Depends on: `000-baseline` (existing POI/linear-feature schema, badges row, admin edit view)
- Blocks: future `017-trip-planning` spec (implementation of issue #366)

---

## Future Considerations (Issue #366)

Issue #366 ("Advanced Google Maps Navigation") proposes saved day-trip plans tied to user accounts, with multi-POI handoff to Google Maps. This spec deliberately constrains the Navigate component's interface (`stops: [{lat, lng}]`) to make that extension trivial:

- A trip-planning feature builds an ordered list of POIs in the user's plan
- The same `NavigateButton` component is reused, just passed more stops
- Google Maps URL format accepts up to 9 waypoints via `&waypoints=A|B|C` — the component will handle truncation/warning if a trip exceeds that
- Each stop already prefers `navigation_*` over base coords, so trips automatically use the better entry points

What's explicitly **out of scope** for #365:
- Persisting trips to user accounts (#366)
- Trip-planning UI (#366)
- Apple Maps deep link (#365 sticks with Google Maps universal URL per the issue; future enhancement could add platform-aware Apple Maps support)

---

## Open Questions

1. **Icon choice** — Small direction-arrow SVG matching the visual weight of the Share icon (~14px). Final SVG path chosen during implementation.

---

## Changelog

| Version | Date       | Changes                                                                                                |
|---------|------------|--------------------------------------------------------------------------------------------------------|
| 0.1.0   | 2026-05-18 | Initial draft                                                                                          |
| 0.2.0   | 2026-05-18 | Add `navigation_latitude`/`navigation_longitude` override fields; hide Navigate on rivers + boundaries |
