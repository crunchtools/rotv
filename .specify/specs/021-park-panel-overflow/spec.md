# Specification: Scrollable Legend Sections (Park/Municipal Panel Overflow Fix)

> **Spec ID:** 021-park-panel-overflow
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-22

## Overview

The map legend panel groups POIs, Parks, and Municipal boundaries into collapsible
accordion sections (see `015-grouped-legend-sections`). Since then the catalog has
grown to ~36 park boundaries plus a long and growing list of municipal/county/city
boundaries (issue #198). On desktop the legend has a fixed height and its content area
is clipped (`overflow: hidden`), so when a user opens the **Parks** or **Municipal**
section the list runs off the bottom of the panel with no way to reach the hidden
entries. This fixes the overflow by making the open section scroll within the panel.

Reported in [#396](https://github.com/crunchtools/rotv/issues/396).

---

## User Stories

### Browsing Parks on the Map

**US-001: See every park in an overflowing section**
> As a map user, I want to scroll through the full list of parks (or municipal
> boundaries) when I open that section, so that I can find and toggle any boundary
> even when there are more than fit on screen.

Acceptance Criteria:
- [ ] Opening the **Parks** section with more entries than fit lets the user scroll (wheel/trackpad/touch/drag) to reach every park chip.
- [ ] No visible scrollbar is rendered — scrolling is "overlay"/hidden, matching the existing pattern used by `.poi-news-list-content` (App.css ~1561).
- [ ] Opening the **Municipal** section behaves identically.
- [ ] The legend panel itself does not grow beyond its existing bounds or run off the map.
- [ ] The section header (and the "All"/"None" actions) and the search box remain visible while the section body scrolls.

**US-002: Accordion behavior is preserved**
> As a map user, I want only one section open at a time so the panel stays compact and
> the open section gets the available height for scrolling.

Acceptance Criteria:
- [ ] Opening one section still collapses the others (existing accordion behavior unchanged).
- [ ] The open section expands to use the remaining panel height; closed section headers stay visible above/below it.

**US-003: Mobile remains usable**
> As a mobile user, I want the panel to keep working as it does today.

Acceptance Criteria:
- [ ] On viewports ≤768px the panel continues to scroll as a whole (no regression).

---

## Data Model

No changes.

---

## API Endpoints

No changes.

---

## UI/UX Requirements

### Changed Components

- `LegendSection` (in `frontend/src/components/Map.jsx`) — mark the open section so CSS can let it grow and scroll.

### Behavior

```
┌─ legend (fixed height: min(480px, 70vh)) ─┐
│ [ Search destinations…            ]       │  ← stays pinned
│ ▸ Points of Interest (14)                 │  ← closed header, pinned
│ ▾ Parks (36)                              │  ← open header + actions, pinned
│   ┌─────────────────────────────────┐ ▲  │
│   │ [chip][chip][chip][chip]        │ │  │  ← body scrolls (overflow-y: auto)
│   │ [chip][chip][chip][chip]        │ █  │
│   │ … remaining chips reachable …   │ ▼  │
│   └─────────────────────────────────┘    │
│ ▸ Municipal (40)                          │  ← closed header, pinned
└───────────────────────────────────────────┘
```

---

## Non-Functional Requirements

**NFR-001: CSS-only behavior change where possible**
- No new dependencies. Reuse existing flexbox layout of `.legend` / `.legend-content`.
- No change to map rendering, boundary fetching, or the show/hide-all actions.

**NFR-002: No regression on mobile**
- The existing `@media (max-width: 768px)` rules that make the whole `.legend` scroll must continue to govern mobile.

---

## Dependencies

- Depends on: `015-grouped-legend-sections` (introduced the accordion sections this fix scrolls).
- Related data growth: issue #198 (added ~36 park + many municipal boundaries).

---

## Open Questions

1. None blocking. A tree/hierarchical grouping (county → city → park) was floated in the
   issue as an alternative, but is deferred as a future enhancement (MINOR) — scrolling
   resolves the reported bug.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-22 | Initial draft |
