# Specification: Map Measuring Tape

> **Spec ID:** 032-measure-tape
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-31

## Overview

Visitors want to know how far apart two places are on the map — trailheads, a
parking lot and a waterfall, two POIs they're deciding between. Today there is no
way to do that. This feature adds a **two-point measuring tape**: a toggleable map
tool that drops two draggable endpoints (A and B), draws a line between them, and
reports the real-world distance live as you drag either end or zoom/pan the map.

Resolves [#452](https://github.com/crunchtools/rotv/issues/452) ("Map Scale Key").
The issue asked for a zoom-aware scale key so users could gauge how far apart POIs
are; a draggable measuring tape solves that problem statement more directly than a
fixed scale bar.

---

## User Stories

### Distance Measurement

**US-001: Measure between two points**
> As a visitor, I want to drop two points on the map and read the distance between
> them so that I can tell how far apart trailheads, POIs, or features are.

Acceptance Criteria:
- [ ] A measure toggle button is available in the map control cluster (top-left, with zoom/locate/satellite).
- [ ] Activating it shows two draggable endpoint handles (A and B) connected by a line.
- [ ] A label shows the geodesic distance between A and B, in imperial primary (ft / mi) with metric secondary (m / km).
- [ ] Endpoints first appear in the bottom-right of the current viewport so they don't cover the map controls.

**US-002: Drag endpoints to measure anything**
> As a visitor, I want to drag each endpoint independently so that I can line them up
> on the two things I actually want to measure.

Acceptance Criteria:
- [ ] Both endpoints are independently draggable.
- [ ] The connecting line and the distance label update live during the drag.
- [ ] Endpoints are large enough to grab on a touchscreen.

**US-003: Stays accurate through zoom and pan**
> As a visitor, I want the distance to stay correct when I zoom or pan so that I trust
> the number.

Acceptance Criteria:
- [ ] Endpoints are anchored to geographic coordinates (lat/lng), not screen pixels — they stay on their map locations through zoom/pan.
- [ ] The reported distance is geodesic (`map.distance`) and does not change on zoom unless an endpoint is moved.

**US-004: Turn it off / get out of the way**
> As a visitor, I want to dismiss the tape when I'm done so that it stops cluttering
> the map.

Acceptance Criteria:
- [ ] Toggling the button off removes both endpoints, the line, and the label.
- [ ] The toggle button shows an active state while the tape is on.
- [ ] Turning the tape off and on again resets endpoints to the default bottom-right position.

---

## Data Model

No database changes. This is a client-only, ephemeral UI tool — measurements are not
persisted.

---

## API Endpoints

None. No backend changes.

---

## UI/UX Requirements

### New Components

- `MeasureTape` — a `useMap()` child of `MapContainer` that, while active, manages two
  draggable Leaflet markers, a connecting polyline, and a distance tooltip. Renders
  nothing when inactive.

### New Control

- A ruler-icon toggle button appended to the existing `ZoomLocateControl` button
  cluster (top-left), driven by a `measureMode` boolean lifted into `Map`.

### Wireframe

```
 map controls (top-left)        measuring tape (starts bottom-right)
 ┌───┐
 │ + │                                   A ●╌╌╌╌╌╌╌╌╌● B
 │ − │                                      ┌─────────────┐
 │ ◎ │  ← locate                            │ 1.24 mi     │
 │ ▦ │  ← satellite                         │ (2.0 km)    │
 │ 📏│  ← measure (NEW, toggles tape)       └─────────────┘
 └───┘
```

### Units

- Imperial primary (US national-park audience): `< 0.1 mi` shown in feet, otherwise miles (2 decimals).
- Metric secondary in parentheses: `< 1 km` shown in meters, otherwise km (2 decimals).

---

## Non-Functional Requirements

**NFR-001: No regression to existing map interaction**
- The tape must not block map clicks, POI selection, or other controls when inactive.
- Dragging an endpoint must not pan the map.

**NFR-002: Accessibility & touch**
- Toggle button has `role="button"`, `aria-label`, and an `aria-pressed`/active state.
- Endpoint handles are at least 24×24px hit targets.

**NFR-003: Code quality**
- Passes the Gourmand gate (no `//` line comments except JSDoc; no single-use helpers).

---

## Dependencies

- Depends on: existing `MapContainer` / `ZoomLocateControl` infrastructure in `Map.jsx`.
- Blocks: none.

---

## Open Questions

1. Should the tape support more than two points (multi-segment path)? — Out of scope for v1; two points only.
2. Should measurements persist across reloads? — No; ephemeral by design.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-31 | Initial draft |
