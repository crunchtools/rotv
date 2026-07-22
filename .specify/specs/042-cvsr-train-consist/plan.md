# Implementation Plan: CVSR Train Consist

> **Spec ID:** 042-cvsr-train-consist
> **Status:** Planning
> **Last Updated:** 2026-07-21
> **Estimated Effort:** M

## Summary

Expose the lead engine's arc distance and travel direction from
`useAnimatedTrackerPosition`, add a pure `buildConsist()` util that turns those into
four `{ position, bearing }` units via the existing `snapAtArc()`, and render the
trailing three as inert Leaflet markers alongside today's lead marker.

---

## Architecture

### Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│                        Map.jsx                           │
│                                                          │
│   ┌────────────────────────────────────────────────┐    │
│   │       useAnimatedTrackerPosition (hook)        │    │
│   │  tweens the GPS fix along the track each frame │    │
│   │  returns { position, bearing, arc, direction } │◄── NEW: arc, direction
│   └────────────────────────────────────────────────┘    │
│                          │                               │
│                          ▼                               │
│   ┌────────────────────────────────────────────────┐    │
│   │        buildConsist()  (pure util, NEW)        │    │
│   │  arc + direction + zoom → 4 × {position,       │    │
│   │  bearing, kind}   via snapAtArc()              │    │
│   └────────────────────────────────────────────────┘    │
│                          │                               │
│                          ▼                               │
│   ┌────────────────────────────────────────────────┐    │
│   │  <Marker> lead (tooltip, click)                │    │
│   │  <Marker> × 3 trailing (inert)                 │    │
│   └────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

1. The hook tweens the lead engine's arc distance along the track every frame (existing).
2. The hook now also returns that arc distance and the `+1/-1` travel direction.
3. `buildConsist()` computes each unit's arc as `leadArc - direction × offsetIndex × spacing`,
   resolves it with `snapAtArc()`, and derives each bearing with `dualSnapBearing()` —
   the same call the lead marker already uses, so curves and direction flips are
   handled identically for every unit.
4. Map.jsx renders the lead marker as today plus three inert trailing markers, and
   writes each unit's rotation in a layout effect.

---

## The spacing problem (key design decision)

The issue asks for "roughly 20-25 meters (typical railcar length)". At the valley's
latitude, Web Mercator ground resolution is:

| Zoom | meters/pixel | 25 m in pixels |
|------|--------------|----------------|
| z18  | 0.45         | 56 px          |
| z16  | 1.79         | 14 px          |
| z14  | 7.18         | 3.5 px         |
| z12  | 28.7         | 0.9 px         |

With 64 px icons, true-to-scale spacing renders as a single opaque pile at every zoom
a user actually browses at. Spacing is therefore computed as:

```
spacingM = max(TRUE_CAR_LENGTH_M, MIN_GAP_PX × metersPerPixel(zoom))
```

- At normal zooms the pixel term dominates: the consist keeps a **constant apparent
  length on screen** and reads as a train at any zoom.
- At z18+ the true-length term dominates: a user zoomed all the way in gets a
  **geographically accurate** train.

The same `metersPerPixel` expression already exists in `useAnimatedTrackerPosition.js`
for the bearing footprint (`156543.03 × cos(41.26°) / 2^zoom`); it moves into
`trackInterpolation.js` as a shared helper rather than being written twice.

Below `MIN_CONSIST_ZOOM` (14) only the lead engine renders — the spec 038 behavior,
and the answer to "what happens at valley-wide zoom".

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Consist geometry | Existing `snapAtArc()` | O(log n) per unit per frame; already proven by the lead tween |
| Unit bearings | Existing `dualSnapBearing()` | Identical curve handling to the lead marker; no second bearing implementation |
| Zephyr car art | Inline SVG in `L.divIcon` | Matches `createBoatIcon()`; no external asset, no CSP/CDN dependency (the engine's USFT PNG is already a remote-host exception) |
| Consist definition | Module-level const array | Declarative; makes a data-driven consist a later drop-in |

---

## Implementation Steps

### Phase 1: Expose lead arc and direction

- [ ] `useAnimatedTrackerPosition.js`: return `arc` and `direction` alongside
      `position`/`bearing` in snap mode (both already exist internally as
      `animated.snap` / `animated.direction`)
- [ ] Extract `metersPerPixel(zoom)` into `trackInterpolation.js` and use it for the
      existing `halfDist` computation

### Phase 2: Consist util

- [ ] New `frontend/src/utils/trainConsist.js` exporting `CONSIST_UNITS`,
      `MIN_CONSIST_ZOOM`, and `buildConsist({ lineCoords, lineDists, leadArc, direction, zoom })`
- [ ] Rear-engine 180° flip applied in the util, not at render time
- [ ] Clamp units that run off either end of the line (`snapAtArc` already clamps)

### Phase 3: Render

- [ ] `createZephyrIcon()` in Map.jsx — fluted stainless coach SVG
- [ ] Render trailing units as `<Marker interactive={false} keyboard={false}>` at a
      lower `zIndexOffset` than the lead
- [ ] Layout effect writes each trailing unit's rotation, mirroring the lead marker's
      existing pre-paint rotation path

### Phase 4: Tests

- [ ] `backend/tests/trainConsist.unit.test.js`

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/utils/trainConsist.js` | Consist definition + `buildConsist()` |
| `backend/tests/trainConsist.unit.test.js` | Unit tests for the above |
| `.specify/specs/042-cvsr-train-consist/` | Spec and plan |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/hooks/useAnimatedTrackerPosition.js` | Return `arc` + `direction`; use shared `metersPerPixel()` |
| `frontend/src/utils/trackInterpolation.js` | Export `metersPerPixel(zoom)` |
| `frontend/src/components/Map.jsx` | `createZephyrIcon()`, consist memo, trailing markers, rotation layout effect |
| `frontend/src/App.css` | `.zephyr-marker-icon` / `.zephyr-marker-inner` styles |

---

## Database Migrations

None.

---

## API Implementation

None.

---

## Testing Strategy

### Unit Tests

- [ ] `backend/tests/trainConsist.unit.test.js`
  - Units trail behind the lead for `direction = +1` and flip for `direction = -1`
  - Arc offsets are monotonic and match the computed spacing
  - Rear engine bearing is 180° from the lead's
  - Spacing takes the pixel term at z14 and the true-length term at z18
  - Consist near a line endpoint clamps instead of throwing
  - Curved geometry: units are NOT collinear (they follow the curve)

### Integration Tests

None — the train marker requires a live GPS fix, which the test seed has no fixture for.

### Manual Testing

1. Open the map with `?feature=CVSR`, zoom to the train at z16 — four units, cars
   between engines, rear engine facing backwards
2. Zoom out past z14 — consist collapses to the lone engine, no position jump
3. Zoom in to z18 — spacing tightens to prototype scale
4. Watch through a curve (the Boston Mill / Peninsula bends) — consist bends with the track
5. Watch a direction reversal (northbound → southbound return) — consist flips to trail correctly
6. Click a Zephyr car — CVSR sidebar opens, same as clicking the engine

---

## Rollback Plan

Frontend-only and additive. If the consist misbehaves in production, revert the
commit; the lead marker path is untouched by design (NFR-042-3).

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| 4× marker updates per animation frame degrade map perf | Med | Trailing markers are `interactive={false}`; positions come from O(log n) lookups, and the component already re-renders every frame for the lead marker |
| Exaggerated spacing reads as "wrong" to a railfan | Low | Floors at true prototype length at high zoom; documented in the spec |
| Direction flips mid-curve cause a visible consist swing | Low | Direction is already debounced by `MIN_DIRECTION_M` in the hook (#554 fix) |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-07-21 | Initial plan |
