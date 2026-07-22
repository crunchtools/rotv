# Specification: CVSR Train Consist

> **Spec ID:** 042-cvsr-train-consist
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty / Josui
> **Date:** 2026-07-21

## Overview

The CVSR live tracker (spec 038) renders the locomotive as a single icon. This spec
extends it to a full train consist: a lead engine, two Zephyr passenger cars, and a
rear engine dragged backwards — each unit snapped to its own point on the railroad
geometry so the train bends through curves the way a real one does. The consist is a
purely visual layer over the existing single GPS fix; no new data source, no backend
change.

---

## User Stories

### Consist Rendering

**US-042-1: See a real train, not a lone engine**
> As a map user watching the CVSR, I want the marker to look like an actual train
> with cars and a trailing engine so that the live tracker feels real rather than
> schematic.

Acceptance Criteria:
- [ ] The consist renders four units: lead engine, two Zephyr cars, rear engine
- [ ] Units trail BEHIND the lead engine relative to the direction of travel
- [ ] Each unit is snapped to the railroad line at its own arc distance, so the
      consist follows curves instead of forming a straight rigid bar
- [ ] The rear engine is rotated 180° from the direction of travel (dragged backwards)
- [ ] Zephyr cars are visually distinct from the engines (silver, fluted, streamlined)
- [ ] When the train reverses direction, the consist flips to trail the other way

**US-042-2: Consist stays readable at every zoom**
> As a user browsing the valley at wide zoom, I want the train to stay legible
> rather than collapsing into an unreadable pile of overlapping icons.

Acceptance Criteria:
- [ ] Below the consist zoom threshold, only the lead engine renders (spec 038 behavior)
- [ ] At and above the threshold, all four units render without overlapping
- [ ] Unit spacing is derived from on-screen pixels at the current zoom, so the
      consist keeps a constant apparent length as the user zooms
- [ ] At very high zoom the spacing floors at true prototype car length, so a user
      zoomed all the way in sees a geographically accurate train
- [ ] Zooming across the threshold does not produce a visible jump in the lead
      engine's position or bearing

**US-042-3: Consist behaves as one marker**
> As a user, I want clicking any part of the train to do the same thing so that the
> cars don't feel like separate map objects.

Acceptance Criteria:
- [ ] Clicking any unit opens the CVSR POI in the sidebar, same as today's marker
- [ ] The hover tooltip (name, status badge, thumbnail) appears from the lead engine only
- [ ] Trailing units are keyboard-inert and are not separate tab stops

---

## Data Model

No schema changes. The consist is derived entirely from the existing
`/api/train/position` fix plus the railroad `linear_features` geometry already
loaded by the map.

---

## API Endpoints

No new or changed endpoints.

---

## UI/UX Requirements

### New Components

- `buildConsist()` (`frontend/src/utils/trainConsist.js`) — pure function mapping a
  lead arc distance + travel direction to per-unit `{ position, bearing }`
- `createZephyrIcon()` (`Map.jsx`) — inline-SVG `L.divIcon` for a stainless-steel
  Zephyr coach, matching the existing `createTrainIcon()` / `createBoatIcon()` idiom

### Layout

```
Direction of travel  ───────────────────►

   [rear engine]  [Zephyr]  [Zephyr]  [lead engine]
      (flipped)                          (GPS fix)
   ◄── trailing ──────────────────────── lead
```

The GPS fix is the LEAD engine. Every other unit sits at a negative arc offset
(behind it along the track, opposite the direction of travel).

---

## Non-Functional Requirements

**NFR-042-1: Animation cost**
- Consist positions are computed from the already-tweened lead arc distance via
  `snapAtArc()` — an O(log n) table lookup per unit per frame, no re-snapping
  against the full geometry
- Bearings are written to the DOM in a layout effect (same pre-paint path as the
  existing lead marker), never by recreating `L.divIcon` instances

**NFR-042-2: Graceful degradation**
- Absent, short, or malformed railroad geometry falls back to the single lead marker
- A consist unit whose arc offset falls off the end of the line clamps to the line
  endpoint rather than disappearing or throwing

**NFR-042-3: No regression to the lead marker**
- The lead engine's position and bearing logic is unchanged from spec 038; the
  consist is additive

---

## Dependencies

- Depends on: `038-cvsr-train-tracker` (merged), and the #554 bearing/direction fixes
  in `useAnimatedTrackerPosition.js`
- Blocks: none

---

## Open Questions

1. Should the consist length eventually be data-driven (CVSR runs different consists
   by excursion)? Out of scope here — hardcoded 4-unit consist for now.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-07-21 | Initial draft |
