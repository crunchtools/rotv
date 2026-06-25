# Specification: Shareable Legend Filters

> **Spec ID:** 039-shareable-legend-filters
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-06-24

## Overview

Users can select/unselect POI types and boundaries in the legend, then share the URL so recipients see exactly the same filter state. This enables focused map views like "just playgrounds" or "show the Train route" to be shared with friends.

---

## User Stories

### Sharing Filtered Views

**US-039-1: Share POI type filters via URL**
> As a user, I want my POI type selections in the legend to be reflected in the URL so that I can share a focused view with friends.

Acceptance Criteria:
- [ ] Toggling POI types in the legend updates `?types=` in the URL without page reload
- [ ] Opening a URL with `?types=trail,historic` shows only those POI types
- [ ] Omitting `?types=` uses the default visible set (current behavior)

**US-039-2: Share boundary selections via URL**
> As a user, I want my boundary selections in the legend to be reflected in the URL so that I can share a view showing specific park boundaries.

Acceptance Criteria:
- [ ] Toggling boundaries in the legend updates `?boundaries=` in the URL without page reload
- [ ] Opening a URL with `?boundaries=123,456` shows only those boundaries
- [ ] Omitting `?boundaries=` uses the default (CVNP only, current behavior)

**US-039-3: Compose with existing URL features**
> As a user, I want filter params to work alongside POI deep-links and tab params so that I don't lose context.

Acceptance Criteria:
- [ ] `/?poi=stanford-hostel&types=trail` deep-links to the POI with trail-only filter
- [ ] `/cuyahoga-valley-scenic-railroad?types=train` works with path-based POI URLs
- [ ] `?tab=settings&types=trail` both open the settings tab and apply the filter

---

## URL Parameter Design

### Query Parameters

| Parameter | Format | Example | Behavior |
|-----------|--------|---------|----------|
| `types` | Comma-separated type names | `?types=trail,historic,playground` | Show only these POI types |
| `boundaries` | Comma-separated boundary IDs | `?boundaries=123,456` | Show only these boundaries |

### Semantics

- **`types` present** → use exactly the listed types (override defaults)
- **`types` absent** → use the default visible types (from iconConfig + DEFAULT_ICON_TYPES, filtering default_hidden)
- **`boundaries` present** → use exactly the listed boundary IDs
- **`boundaries` absent** → use the default (CVNP boundary)
- Parameters are consumed on load, then updated live as the user interacts with the legend

---

## Non-Functional Requirements

**NFR-039-1: URL cleanliness**
- When all filters match the default state, the `types` and `boundaries` params should be absent (clean URL)
- Only add params when the state differs from defaults

**NFR-039-2: No page reloads**
- Use `window.history.replaceState()` to update the URL without triggering navigation

---

## Dependencies

- Depends on: existing legend toggle infrastructure (Map.jsx, App.jsx)
- No database changes required
- No new API endpoints required

---

## Open Questions

1. ~~Should we use type names or type IDs in the URL?~~ Type names — they're human-readable and stable.
2. Should "show all" / "hide all" buttons also update the URL? Yes, for consistency.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06-24 | Initial draft |
