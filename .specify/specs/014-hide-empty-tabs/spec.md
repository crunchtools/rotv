# Specification: Hide Empty Tabs in POI Sidebar

> **Spec ID:** 014-hide-empty-tabs
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-16

## Overview

The POI sidebar currently renders every tab (Info, News, Events, History, Associations) regardless of whether the tab has content. Users click empty tabs expecting information and get an "empty" message. This spec hides tabs that have no content for public viewers while preserving full tab visibility for admin users in edit mode (who need the empty tabs to add content).

Source: GitHub issue #211, feedback from Robbie Schneider (April 11, 2026).

---

## User Stories

### Public Viewer

**US-001: Hide empty tabs**
> As a public viewer, I want to see only tabs that have content so that I don't waste clicks discovering empty sections.

Acceptance Criteria:
- [ ] Sidebar tabs with zero content items are not rendered for non-admin users
- [ ] The Info tab is always shown (it always has at least a name)
- [ ] Tab visibility is recalculated when the POI changes
- [ ] Works for both regular POIs (destinations) and linear features (trails, rivers, boundaries)

**US-002: Default to a visible tab**
> As a public viewer arriving via a deep link to a tab that is no longer visible, I want to land on the Info tab instead of a blank panel.

Acceptance Criteria:
- [ ] If the active tab becomes hidden (e.g., URL deep-link to `/poi/news` but POI has no news), the sidebar falls back to Info
- [ ] The URL is updated to reflect the fallback so the back button behaves predictably

### Admin / Content Curator

**US-003: Admin always sees all tabs**
> As an admin in edit mode, I want to see all tabs even when empty so I can add content (news, events, history, associations).

Acceptance Criteria:
- [ ] When `isAdmin && editMode`, all five tabs render regardless of content
- [ ] Behavior matches existing admin workflow — no regression for content curation

### Automatic Recovery

**US-004: Tabs reappear when content is added**
> As a public viewer revisiting a POI after content was added, I want the relevant tab to reappear automatically.

Acceptance Criteria:
- [ ] Tab visibility is driven by the POI detail response on each fetch — no client-side caching of "this tab is hidden"
- [ ] When a new event, news item, or association is added, the next page load shows the tab

---

## Data Model

No schema changes. Visibility is derived from existing tables (`poi_news`, `poi_events`, `poi_associations`, `pois.historical_description`).

---

## API Endpoints

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/pois/:id` | Add `news_count`, `events_count`, `associations_count` to response |
| GET | `/api/destinations/:id` | Same additions (if used by sidebar) |
| GET | `/api/linear-features/:id` | Same additions |

Counts respect existing visibility rules:
- `news_count`: `poi_news` rows with `moderation_status IN ('published', 'auto_approved')`
- `events_count`: `poi_events` rows with `moderation_status IN ('published', 'auto_approved')` AND upcoming (matches default Events tab view)
- `associations_count`: rows in `poi_associations` where this POI is either side

`has_history` is derivable client-side from existing `historical_description` field.

---

## UI/UX Requirements

### Behavior

- **Public viewer:** tabs render iff they have content
- **Admin in edit mode:** all tabs render
- **Deep link to hidden tab:** fallback to Info

### Visual

No new visual treatment. Tabs that disappear simply aren't in the tab strip. Existing tab strip layout works unchanged with fewer buttons.

---

## Non-Functional Requirements

**NFR-001: No additional round trips**
- Counts must come from the existing POI detail fetch — do not introduce N additional API calls per POI open.

**NFR-002: Query cost**
- Count additions to the POI detail query must use indexed columns or subqueries that complete in well under 50ms.

---

## Dependencies

None.

---

## Open Questions

1. Should "past events" make the Events tab visible, or only upcoming? **Resolved: upcoming only** (matches current default Events tab behavior).
2. Linear features — do they have Associations? **Yes**, same logic applies.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-16 | Initial draft |
