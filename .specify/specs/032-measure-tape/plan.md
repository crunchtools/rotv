# Implementation Plan: Map Measuring Tape

> **Spec ID:** 032-measure-tape
> **Status:** Planning
> **Last Updated:** 2026-05-31
> **Estimated Effort:** S

## Summary

Add a `measureMode` boolean to `Map`, a ruler toggle button in the existing
`ZoomLocateControl` cluster, and a new `MeasureTape` `useMap()` child component that
manages two draggable Leaflet markers + a polyline + a distance tooltip while active.
Frontend-only, no backend or DB changes.

---

## Architecture

### Component Diagram

```
┌─────────────────────── Map.jsx ───────────────────────┐
│  state: measureMode (bool)                             │
│                                                        │
│  <MapContainer>                                        │
│    ┌──────────────────────────────────────────────┐   │
│    │ ZoomLocateControl                            │   │
│    │   + / − / locate / satellite / [MEASURE 📏] ──┼──▶ toggles measureMode
│    └──────────────────────────────────────────────┘   │
│    ┌──────────────────────────────────────────────┐   │
│    │ MeasureTape (active only)                    │   │
│    │   markerA ●╌╌╌polyline╌╌╌● markerB           │   │
│    │   tooltip: "1.24 mi (2.0 km)"                │   │
│    └──────────────────────────────────────────────┘   │
│  </MapContainer>                                       │
└────────────────────────────────────────────────────────┘
```

### Data Flow

1. User clicks the ruler button → `ZoomLocateControl` calls `onToggleMeasure()` → `Map` flips `measureMode`.
2. `measureMode` true → `<MeasureTape active />` mounts; on mount it computes two default
   endpoints in the bottom-right quadrant of the current viewport via
   `map.containerPointToLatLng()` and adds markers + polyline + tooltip to the map.
3. Dragging an endpoint fires `drag` → update the polyline latlngs and recompute the
   label with `map.distance(a, b)`.
4. `measureMode` false (or unmount) → remove markers, polyline, tooltip.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Endpoints | `L.marker({ draggable: true })` with a `divIcon` handle | `L.marker` supports native dragging; `CircleMarker` does not |
| Line | `L.polyline` | Lightweight, redraws on drag |
| Label | `L.tooltip` bound to the polyline midpoint (permanent) | Stays attached, no extra DOM plumbing |
| Distance | `map.distance(a, b)` (geodesic, meters) | Accurate at any latitude; matches existing river-gauge code style |
| Toggle | Extra `<a>` in the existing `ZoomLocateControl` `L.Control` | Reuses the established control pattern and styling |

---

## Implementation Steps

### Phase 1: Toggle plumbing

- [ ] Add `measureMode` state + `onToggleMeasure` to `Map`.
- [ ] Add a ruler `<a class="zoom-locate-btn measure-button">` to `ZoomLocateControl`, wired to `onToggleMeasure`; reflect active state with an `active` class.
- [ ] Pass `useMeasure`/`onToggleMeasure` props into `ZoomLocateControl` (mirrors `useSatellite`/`onSatelliteToggle`).

### Phase 2: MeasureTape component

- [ ] New `MeasureTape({ active })` `useMap()` child.
- [ ] On activate: compute default A/B in bottom-right quadrant (e.g. container points at 78%×80% and 90%×80%), add two draggable divIcon markers, a polyline, and a permanent midpoint tooltip.
- [ ] `drag` handlers update polyline + tooltip position + label live.
- [ ] `formatDistance(meters)` → imperial primary (ft `< 0.1 mi`, else mi 2dp) + metric secondary (m `< 1 km`, else km 2dp).
- [ ] Cleanup on deactivate/unmount removes all layers; re-activate resets to default position.

### Phase 3: Styling & polish

- [ ] CSS for `.measure-button` (matches sibling control buttons) + active state.
- [ ] CSS for `.measure-handle` divIcon (≥24px, grabbable) and `.measure-tooltip` label.
- [ ] `L.DomEvent.disableClickPropagation` so dragging doesn't pan/select.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| (none — `MeasureTape` lives in `Map.jsx` alongside the other `useMap` children) | Keeps the map components co-located, as `ZoomLocateControl` already is |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/Map.jsx` | Add `measureMode` state; add `MeasureTape` component; add ruler button + props to `ZoomLocateControl`; render `<MeasureTape>` inside `MapContainer` |
| `frontend/src/App.css` | `.measure-button`, `.measure-handle`, `.measure-tooltip` styles (near the existing `.zoom-locate-btn` rules) |

---

## Database Migrations

None.

---

## API Implementation

None.

---

## Testing Strategy

### Manual Testing

1. Click the ruler button → tape appears in the bottom-right with a distance label.
2. Drag endpoint A onto one POI and B onto another → label updates live and reads a plausible distance.
3. Zoom in/out and pan → endpoints stay glued to their map locations; the distance number stays stable until an endpoint is moved.
4. Verify dragging an endpoint does NOT pan the map.
5. Toggle the button off → tape fully disappears; toggle on → resets to bottom-right.
6. Touch test (or narrow viewport) → handles are grabbable.

### Automated

- Existing Playwright smoke suite must still pass (`./run.sh test`, run by `/deploy`). No new e2e required for v1; the tool is additive and inactive by default.

---

## Rollback Plan

1. Frontend-only and inactive by default — revert the `Map.jsx`/CSS changes.
2. No data migration to unwind.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Endpoint drag pans the map | Med | `disableClickPropagation` + marker `draggable` handles its own events |
| Tooltip/markers leak on toggle | Low | Explicit cleanup in `useEffect` return; keyed on `active` |
| Distance label overlaps controls | Low | Default endpoints placed bottom-right, away from top-left controls |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-31 | Initial plan |
