# Specification: Favorites List (enriched) + "Following" → "Favorite" rename

> **Spec ID:** 033-favorites-list
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-06-01

## Overview

The My Valley hub already has a list of the places a user follows, but each row only
shows a name and an Unfollow button. This feature turns that into the "My List" view
#437 asked for: each favorited place shows its current trail status, recent-news count,
and upcoming-events count, is clickable to jump to the place on the map, and the list is
sortable and filterable. It also renames the feature from **"Following"** to
**"Favorite"** across the interface and code, so the saved-places concept reads
consistently with the existing favorites backend and can grow.

Resolves [#437](https://github.com/crunchtools/rotv/issues/437) (child of #141 UX 1.0).
Builds on the My Valley hub + favorites system from #429/PR #451 and #387.

---

## User Stories

### Enriched list

**US-001: See what's happening at my places**
> As a signed-in (or anonymous) user, I want each favorite to show its current status and
> activity so that I can tell at a glance where something is going on.

Acceptance Criteria:
- [ ] Each favorite row shows a trail StatusBadge when a trail status is known (open/closed/limited/maintenance), and nothing (or "—") when not applicable.
- [ ] Each row shows a recent-news count and an upcoming-events count (counts use the same published/auto_approved + future-event rules as the POI detail tab counts).
- [ ] Counts of zero render as a muted "0" (or are omitted), not an error.

**US-002: Jump to a place**
> As a user, I want to click a favorite so that I'm taken to it on the map.

Acceptance Criteria:
- [ ] Clicking a favorite's name navigates to the POI (`/<slug>/info`) and closes the My Valley modal (i.e. "show it on the map").
- [ ] The news / events count chips open that POI's news/events **inside My Valley** as a back-able detail panel (master→detail), so focus stays in the modal and the behavior is identical on mobile and desktop. The panel reuses the existing sidebar `PoiNews`/`PoiEvents` components for the same look/feel, with a News|Events toggle.
- [ ] Clicking an individual article opens the full article **inside** My Valley (reusing the sidebar `ContentDetail`), with Back returning to the news/events list — focus never leaves the modal. Three levels: favorites list → POI news/events → article.
- [ ] Clickable name + counts render green, like normal links.
- [ ] The Remove (un-favorite) control still works and does not trigger navigation.

**US-003: Sort and filter**
> As a user with many favorites, I want to sort and filter the list so that I can find what
> I care about.

Acceptance Criteria:
- [ ] Sort options: Recently added (default), Name (A–Z), Most activity (news + upcoming events).
- [ ] Filter by type derived from `poi_roles` (e.g. All / Trails / Parks / Rivers), shown only when there is more than one type present.
- [ ] Sorting/filtering is client-side over the already-loaded list (no extra round-trips).

### Rename

**US-004: Consistent "Favorite" language**
> As a user, I want the saved-places feature to be called "Favorite" everywhere so that the
> star icon, the toggle, the list tab, and the notifications copy all agree.

Acceptance Criteria:
- [ ] The My Valley tab reads "★ Favorites (N)" (was "⭐ Following"), and is the **first** tab (order: Favorites, Visited, Trips), shown by default when the modal opens.
- [ ] The POI toggle reads "Favorite" / "Favorited" with "Add to favorites" / "Remove from favorites" titles (was "Follow" / "Following").
- [ ] Empty-state and NotificationBell copy say "Favorite places" (was "Follow places").
- [ ] Internal identifiers in `MyValley.jsx` use favorite naming (`view === 'favorites'`, `favoriteList`, `handleRemoveFavorite`). Backend already uses `favorites` / `user_poi_favorites`; no DB rename.

---

## Data Model

No schema changes. Reads existing tables: `user_poi_favorites`, `pois`, `poi_news`,
`poi_events`, `trail_status`.

---

## API Endpoints

### Modified

| Method | Path | Change | Auth |
|--------|------|--------|------|
| GET | `/api/favorites` | **Additive**: each row also returns `trail_status` (latest, or null), `news_count`, `events_count`. Accepts `?tz=` (whitelisted IANA, like `/api/pois/:id/tab-counts`). Existing fields unchanged. | Yes |

### New

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/pois/summary?ids=1,2,3&tz=` | Public batch enrichment: returns `[{ id, trail_status, news_count, events_count }]` for the requested ids (non-deleted, capped at 200). Mirrors the notification feed's `?pois=` precedent so **anonymous** (localStorage) favorites get the same status/counts as the signed-in list — closes the local-first gap. Registered before `/api/pois/:id` so `summary` isn't parsed as an id. | No |

Counts are computed against the POI's own id (no boundary/org rollup) in a single query
via `LEFT JOIN LATERAL` — favorites are overwhelmingly point POIs, and this keeps each
endpoint to one query with no N+1.

---

## UI/UX Requirements

### Modified Components

- `MyValley.jsx` — rename Following→Favorites; enrich rows (StatusBadge, count chips,
  clickable navigate); add sort + type-filter controls; in-modal news/events/article detail.
- `FavoriteToggle.jsx` — relabel to Favorite/Favorited.
- `NotificationBell.jsx` — "Favorite places (★) …" copy.

### App-wide back button (US-005)

New shared `BackButton.jsx` standardizes every navigational back control to a single
look (`.back-button`) and a destination-agnostic label — just **"← Back"**. A back button
describes the action, not the destination, because a view (e.g. `ContentDetail`) can be
reached from multiple places; a baked-in name ("Back to <POI>") is misleading in one of
them. Swapped at all text call sites: `ContentDetail`, `MyValley`, `NewsPermalink`,
`EventPermalink`, `TripsManager`, `PrivacyPolicy`. (Icon-only/​pagination controls are
out of scope: the sidebar MTB header `←` and ModerationInbox pagination "Back".)

### Anonymous users

Anonymous favorites (localStorage ids) render with the **same** status/counts as the
signed-in list, fetched from the public `GET /api/pois/summary` batch endpoint and merged
client-side. Name + navigate + Remove + sort/filter all work without sign-in. If the
enrichment fetch fails, rows gracefully fall back to names only. This fully honors the
local-first rule (the user-specific favorites state is localStorage-backed and syncs on
sign-in; the public POI status/counts are available to everyone).

### Wireframe

```
★ Favorites (4)     [ Sort: Recently added ▾ ]  [ All | Trails | Parks ]
┌──────────────────────────────────────────────┐
│ Brandywine Falls          ✓ Open   📰 3  📅 1  ✕ │
│ East Rim MTB Trails       ⚠ Limited 📰 0  📅 2  ✕ │
│ Boston Mill Visitor Ctr             📰 5  📅 0  ✕ │
└──────────────────────────────────────────────┘
  (row click → navigate to /<slug> + close;  ✕ = remove)
```

---

## Non-Functional Requirements

**NFR-001: Local-first parity** — anonymous path works from localStorage and gets the same public status/counts as signed-in (via `/api/pois/summary`); no sign-in required to see/enrich/remove favorites.

**NFR-002: No N+1** — enrichment is a single SQL query; sort/filter is client-side.

**NFR-003: No regression** — `/api/favorites` change is additive; existing consumers keep working. Backend favorite tables/routes are not renamed.

**NFR-004: Code quality** — passes the Gourmand gate.

---

## Dependencies

- Depends on: favorites system (#387), My Valley hub (#429/PR #451), `StatusBadge`, `generateSlug`, `getRollupPoiIds` pattern.
- Parent: #141 (UX 1.0).

---

## Open Questions

1. Should boundary/org favorites use rolled-up counts like the detail view? — Deferred; own-id counts for now (favorites are rarely boundaries).
2. Filter set — start with type chips derived from `poi_roles`; revisit status-based filtering if asked.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06-01 | Initial draft |
