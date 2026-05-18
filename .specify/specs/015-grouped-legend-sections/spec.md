# Specification: Grouped Legend Sections + Astronomy

> **Spec ID:** 015-grouped-legend-sections
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-18

## Overview

Reorganize the map legend panel into three collapsible sections — **Points of Interest** (expanded), **Parks** (collapsed), **Municipal** (collapsed) — so it stays scannable as the icon catalog and boundary list grow. Bundles issue #6: add Astronomy as a new activity, icon, and example POI for the Fairlawn Rotary Observatory in Bath, OH.

---

## User Stories

### Legend Navigation

**US-015-1: Quickly find a POI category**
> As a map visitor, I want the legend grouped into clearly labeled sections so I can find what I'm looking for without scrolling past chips I don't care about.

Acceptance Criteria:
- [ ] Legend renders three sections in fixed order: Points of Interest, Parks, Municipal.
- [ ] Each section has a header showing label + count badge (`Parks (2)`).
- [ ] Points of Interest is expanded on first load; Parks and Municipal are collapsed.
- [ ] Clicking a header toggles only that section. Chevron icon rotates to indicate state.
- [ ] Section state is local UI only — does not persist across reloads.

**US-015-2: Show/hide all within a boundary group**
> As a map visitor, I want to toggle all park boundaries or all municipal boundaries independently so I'm not forced to enable cities just to see CVNP.

Acceptance Criteria:
- [ ] Parks and Municipal sections each have their own All/None controls inside the header.
- [ ] All/None affects only the boundaries in that section.
- [ ] The existing global "show all POIs" / "hide all POIs" controls stay in the POI header.

**US-015-3: Municipal includes counties and state**
> As a map visitor, I want to be able to toggle county and state boundaries from the legend.

Acceptance Criteria:
- [ ] County boundaries (Cuyahoga, Summit) appear as toggles in the Municipal section.
- [ ] Ohio state boundary appears as a toggle in the Municipal section.
- [ ] Existing municipal boundaries (Akron, Cuyahoga Falls) appear in the same section.

### Astronomy (closes #6)

**US-015-4: Browse astronomy sites on the map**
> As a map visitor, I want an Astronomy filter chip so I can find observatories and stargazing spots.

Acceptance Criteria:
- [ ] An Astronomy chip with a telescope icon appears in the Points of Interest section.
- [ ] Toggling it shows/hides POIs whose `primary_activities` includes "Astronomy".
- [ ] The Fairlawn Rotary Observatory (4160 Ira Road, Bath OH) appears as an example POI with description, meetup link, and SCAC ownership.

---

## Data Model

### Schema Changes

None. `pois.boundary_type` already supports the values used (`park`, `municipal`, `city`, `township`, `village`, `county`, `state`). Astronomy reuses existing `activities`, `icons`, and `pois` tables.

### Seed Inserts (migration 051)

- `activities`: one row, `name='Astronomy'`.
- `icons`: one row, `name='astronomy'`, inline SVG content, keyword/fallback set.
- `pois`: one row for Fairlawn Rotary Observatory.

---

## API Endpoints

No new endpoints. Existing `/api/linear-features` already returns `boundary_type`; existing `/api/admin/icons` already returns the icon catalog the frontend consumes.

---

## UI/UX Requirements

### New Components

- `LegendSection` (local helper inside `Map.jsx`) — renders header (button with chevron, label, count badge, optional All/None controls) and a `<div role="group">` body hidden via the native `hidden` attribute when collapsed.

### Wireframes

```
┌────────────────────────────────────┐
│  [search box]                      │
│  ──────────────────────────────    │
│  ▼ Points of Interest (15) [All|None]
│    [Hiking] [Biking] [Camping] ... │
│    [Astronomy] ...                 │
│  ──────────────────────────────    │
│  ▶ Parks (2)            [All|None] │
│  ──────────────────────────────    │
│  ▶ Municipal (5)        [All|None] │
└────────────────────────────────────┘
```

---

## Non-Functional Requirements

**NFR-015-1: Accessibility**
- Section headers are `<button>` elements with `aria-expanded` reflecting state.
- Collapsed bodies use the `hidden` attribute so screen readers skip them.
- Tab order: POI header → POI chips (when open) → Parks header → Municipal header.

**NFR-015-2: No regression on existing legend behavior**
- Search input still filters.
- Trails/Rivers layer toggles still function (placed inside POI section).
- Outer `isLegendExpanded` mobile collapse still works.

---

## Dependencies

- Depends on: nothing (uses existing data + APIs).
- Closes: issue #6 (Add Astronomy Activity).

---

## Open Questions

None at draft time. Section default-state and grouping rules confirmed with Scott on 2026-05-18.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-18 | Initial draft |
