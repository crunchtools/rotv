# Implementation Plan: Consist Anchor at the Tracked Unit


> **Spec ID:** 043-consist-anchor
> **Status:** Planning
> **Last Updated:** 2026-07-22
> **Estimated Effort:** S

---

## Context

The CVSR consist shipped in #533 assumes the GPS device rides in the **lead
locomotive**: `buildConsist()` places unit 0 at the reported position and trails the
rest behind it. That assumption is false, and it is nowhere stated in the code.

The device actually rides further back, so the entire drawn train is displaced
backward from reality. Zoomed in, the train never looks like it is *at* a station when
it is stopped there — the drawn locomotive is short of the platform.

**Evidence.** Snapping both the GPS fix and the station POIs onto the railroad
geometry (which cancels out the fact that station POIs are depot buildings sitting
6–27 m off the rails), a parked fix at Akron Northside sat **51 m** along-track from
the station:

| | arc along the line |
|---|---|
| Akron Northside station (POI 5709) | 544 m |
| Parked GPS fix | 493 m |

One sample gives magnitude but not sign, and it conflates "where the device sits" with
"depot building vs. boarding point". Scott's judgement — he has watched this on the
map repeatedly — is that the device is in the **first coach**. That is the anchor this
plan implements.

**Approach decision.** Fixed offset, always honest: the drawn train keeps the same
real relationship to the device everywhere on the route. Explicitly *not* snapping the
consist to stations — that would fabricate position, and a train stopped short of a
platform would still be drawn at it, which is exactly wrong for someone timing a
bike-aboard pickup.

---

## Design

### 1. Make the tracked unit explicit — `frontend/src/utils/trainConsist.js`

The physical fact belongs with the consist definition, not buried in arithmetic:

```js
export const CONSIST_UNITS = [
  { key: 'lead',  kind: 'engine', flip: false },
  { key: 'car-1', kind: 'zephyr', flip: false, tracked: true },  // GPS device rides here
  { key: 'car-2', kind: 'zephyr', flip: false },
  { key: 'rear',  kind: 'engine', flip: true  },
];
```

Derive the index once from that flag rather than hardcoding a second constant that can
drift out of sync with the array.

### 2. Generalise the placement — same file

Rename `leadArc` → `anchorArc` (it is no longer the lead) and place every unit
relative to the tracked one:

```js
const snap = snapAtArc(lineCoords, lineDists, anchorArc + dir * (trackedIndex - i) * spacing);
```

Units ahead of the tracked one (lower index) go forward along the direction of travel;
units behind go back. This reduces exactly to today's formula when `trackedIndex === 0`,
so the change is a strict generalisation and the existing geometry is a special case of
it.

Everything else in `buildConsist()` is unchanged — `snapAtArc()` still clamps at the
line ends, `dualSnapBearing()` still gives each unit its own local tangent, and the
`flip` handling for the tail engine is untouched.

### 3. Unify the rendering — `frontend/src/components/Map.jsx`

Today the lead marker is drawn from `animatedTrain.position` and the rest from
`buildConsist(...).slice(1)`. That split only made sense while the GPS fix *was* the
lead engine. Now it isn't, so:

- Compute the consist at **all** zooms (it is four `O(log n)` lookups; the current
  `mapZoom < MIN_CONSIST_ZOOM` early-return moves to the render, not the memo).
- Render **unit 0** (the lead engine) with the tooltip, click handler and
  `TRACKER_Z_INDEX` — the head of the train stays the primary marker.
- Below `MIN_CONSIST_ZOOM`, render *only* unit 0. Computing the consist at every zoom
  keeps the engine's position continuous across the threshold instead of jumping ~43 m
  as the cars appear.
- **Fallback:** if `buildConsist()` returns `[]` but `animatedTrain` exists, render the
  lead engine at `animatedTrain.position` — today's behaviour. This preserves the
  intent of NFR-042-3 (a consist bug must not make the train vanish) now that
  `buildConsist()` is load-bearing for the primary marker.

The rotation layout effect currently keyed on `animatedTrain.bearing` for the lead
marker switches to the consist's unit-0 bearing, so all four units are written on one
pre-paint path.

### 4. Supersede the spec

`.specify/specs/042-cvsr-train-consist/` states the GPS fix *is* the lead engine, and
NFR-042-3 freezes the lead marker's position source. Both are deliberately changed
here. Add `.specify/specs/043-consist-anchor/` recording the new model, the 51 m
measurement, and the honest-offset-over-station-snapping decision.

---

## Known trade-off, to record rather than solve

Spacing is exaggerated below z18 (`unitSpacingMeters()`), so moving the anchor back one
unit draws the lead engine one spacing *ahead* of the fix:

| Zoom | spacing | engine drawn ahead of the fix |
|------|---------|-------------------------------|
| z18 | 25 m | 25 m — realistic |
| z17 | 45 m | 45 m |
| z14 | 358 m | 358 m |

This is still better than today, where the head is drawn *at* the fix while really
being ~50 m ahead of it — and far better than anchoring at the tail engine, which would
put the head 1,074 m ahead at z14. Station alignment only matters at z17+, where
spacing is near true scale. The underlying exaggeration is #572's territory, not this
change's.

---

## Files

| File | Change |
|------|--------|
| `frontend/src/utils/trainConsist.js` | `tracked` flag, derived index, `anchorArc` placement |
| `frontend/src/components/Map.jsx` | unified consist rendering, unit-0 tooltip, empty-consist fallback |
| `backend/tests/trainConsist.unit.test.js` | rework for the anchor; new anchor-specific cases |
| `.specify/specs/043-consist-anchor/` | new spec + plan |

No backend, schema, or API change. `useAnimatedTrackerPosition` is untouched — it
already returns `arc` and `direction`.

---

## Verification

**Unit tests** (`./run.sh test`, or `npx vitest run backend/tests/trainConsist.unit.test.js`
while iterating):

- The tracked unit sits *exactly* on `anchorArc`, for both travel directions
- Units ahead of it are forward along travel; units behind are back
- `trackedIndex === 0` reproduces the pre-existing geometry exactly (regression guard)
- Adjacent gaps still equal `unitSpacingMeters(zoom)`
- Tail engine still 180° from the lead; consist still bends on a curve
- Endpoint clamping and degenerate-geometry cases still return sanely

**Live check** — CVSR runs Wed–Sun, so this needs an operating day:

1. `./run.sh build && ./run.sh start`, open `?feature=CVSR`
2. Wait for a station stop (Boston Mill and Peninsula are the easiest to catch), zoom
   to z17–18, and confirm the **lead engine** now sits at the platform rather than
   short of it
3. Zoom across the z14 threshold and confirm the engine does not jump position as the
   cars appear
4. Confirm the tooltip and click still work from any unit

**Measure the residual.** The arc-snapping method used to produce the 51 m figure is
worth keeping: snap the live fix and the station POI to the railroad geometry (POI 5660,
704 vertices) and difference their arc positions. Run it at a few stops after the change
to see whether the remaining error justifies moving the anchor again — this converts
"looks about right" into a number.

**Do not** verify by comparing the raw GPS lat/lng to a station POI's lat/lng. Station
POIs are depot buildings 6–27 m off the rails, so that measurement conflates
perpendicular building offset with along-track position.

---

## Follow-up, not in scope

`trainTrackerService.js` reads only `location` and `ignition` from the USFT
`/map/devices` payload. The raw response may carry a device label identifying which
unit it is mounted in, which would replace Scott's judgement call with a fact. Worth
logging once, but it does not block this change.
