# Specification: Consist Anchor at the Tracked Unit

> **Spec ID:** 043-consist-anchor
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty / Josui
> **Date:** 2026-07-22

## Overview

Spec 042 draws the CVSR consist on the assumption that the GPS device rides in the lead
locomotive. It does not — it rides further back, so the whole drawn train is displaced
backward from reality and the locomotive never reaches the platform when the train is
stopped at a station. This spec makes the tracked unit an explicit property of the
consist and places every other unit relative to it.

---

## User Stories

### Position Accuracy

**US-043-1: The train looks like it is at the station when it is**
> As a Towpath user timing a bike-aboard pickup, I want the drawn locomotive to reach
> the platform when the train has actually stopped there, so that I can trust what the
> map is telling me.

Acceptance Criteria:
- [ ] The unit carrying the GPS device is drawn exactly on the reported position
- [ ] Units ahead of it are drawn forward along the direction of travel
- [ ] Units behind it are drawn backward
- [ ] At a station stop, zoomed to z17–18, the lead engine sits at the platform rather
      than short of it
- [ ] The relationship holds everywhere on the route, not only near stations

**US-043-2: The tracked unit is stated, not implied**
> As a developer, I want to see which unit carries the GPS device declared in the
> consist definition, so that the assumption is visible and correctable rather than
> buried in arithmetic.

Acceptance Criteria:
- [ ] `CONSIST_UNITS` marks the tracked unit
- [ ] Moving the device to another unit is a one-line change with no arithmetic edits
- [ ] Marking the lead engine as tracked reproduces the spec 042 geometry exactly

### Robustness

**US-043-3: A consist fault never hides the train**
> As a user, I want the train to stay on the map even if the consist geometry cannot be
> computed, so that a rendering bug does not look like the tracker going down.

Acceptance Criteria:
- [ ] When the consist cannot be built, the lead engine still renders at the reported
      position (spec 038 behaviour)
- [ ] Below the consist zoom threshold, only the lead engine renders
- [ ] Crossing the zoom threshold does not jump the engine's position

---

## Data Model

No schema changes.

---

## API Endpoints

No new or changed endpoints.

---

## UI/UX Requirements

The drawn consist, with the device in the first coach:

```
direction of travel  ───────────────►

   [rear engine]  [car 2]  [car 1]  [lead engine]
      (flipped)              ▲
                             │
                     the reported GPS position
```

Previously the reported position sat under the lead engine, which pushed the entire
train ~50 m back along the track.

---

## Non-Functional Requirements

**NFR-043-1: Honest position**
- The drawn consist keeps a fixed, real relationship to the reported position
  everywhere on the route
- Position is never adjusted to make the train agree with a station. A train stopped
  short of a platform must be drawn short of it

**NFR-043-2: Supersedes NFR-042-3**
- Spec 042 froze the lead marker's position source to the raw tracker state so a
  consist bug could not regress it. That is no longer possible — the lead engine is now
  a derived position. The intent is preserved by falling back to the raw tracker
  position whenever the consist cannot be built

---

## Dependencies

- Supersedes parts of `042-cvsr-train-consist` (the GPS fix is no longer the lead engine)
- Related: #572 (spacing breathes during zoom animation) — shares the spacing model but
  is independent of this change

---

## Open Questions

1. Which unit *actually* carries the device. Set to the first coach on the product
   owner's judgement; a measured 51 m offset at Akron Northside is consistent with it.
   `trainTrackerService.js` reads only `location` and `ignition` from the USFT payload —
   a device label in the raw response would settle it.
2. How much of the measured 51 m is device placement versus the station POI being a
   depot building rather than a boarding point.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-07-22 | Initial draft |
