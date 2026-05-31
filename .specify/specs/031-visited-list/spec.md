# Specification: Visited List & "My Valley" Hub

> **Spec ID:** 031-visited-list
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-30

## Overview

Users can mark POIs as **visited**, building a personal exploration log with
progress stats ("23 of 371 explored"). The visited list, followed places, and
saved trips are surfaced together in a new **My Valley** personalization hub.
Like all user data in ROTV, this is local-first: it works for anonymous visitors
via `localStorage` and syncs to the account on first sign-in. Foundation for the
#141 badge system and recommendations.

---

## User Stories

### Visited

**US-031-1: Mark a place visited**
> As a visitor, I want to mark a POI as visited from its sidebar so that I can
> keep a log of where I've been.

Acceptance Criteria:
- [ ] A "Mark visited" / "Visited" toggle appears in the POI sidebar button row.
- [ ] Works signed-out (persists to `localStorage`) and signed-in (persists to DB).
- [ ] Toggling is optimistic and reflects immediately.

**US-031-2: See my exploration progress**
> As a visitor, I want to see how many of the valley's locations I've explored so
> that I get a sense of discovery and completeness.

Acceptance Criteria:
- [ ] My Valley shows "N of M explored" with a progress bar.
- [ ] M = count of markable point locations; N = distinct visited point locations.

### My Valley hub

**US-031-3: View my valley**
> As a visitor, I want one place that shows my Visited, Following, and Trips so I
> can manage my personal valley.

Acceptance Criteria:
- [ ] Reachable from the account dropdown (signed in) and the Login dropdown (signed out).
- [ ] Signed-out shows local data plus a "sign in to save across devices" nudge.
- [ ] Unmark/unfollow from the hub updates the lists.

### Sync

**US-031-4: Keep my list on sign-in**
> As an anonymous visitor who later signs in, I want my visited places saved to my
> account so they follow me across devices.

Acceptance Criteria:
- [ ] On first sign-in, local visited ids sync into `user_visits` (idempotent).
- [ ] Re-syncing never duplicates rows.

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `user_visits` | One row per (user, visited POI), with `visited_at`. |

### Schema Changes

```sql
CREATE TABLE IF NOT EXISTS user_visits (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poi_id     INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, poi_id)
);
CREATE INDEX IF NOT EXISTS idx_user_visits_poi ON user_visits (poi_id);
```

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/visited` | List the user's visited POIs | Yes |
| GET | `/api/visited/stats` | `{ visited, total }` progress counters | Yes |
| POST | `/api/visited/:poiId` | Mark a POI visited | Yes |
| DELETE | `/api/visited/:poiId` | Unmark a POI | Yes |

`/auth/user` gains a `visited` array; `/api/user/settings/sync` accepts a `visited` array.

---

## UI/UX Requirements

### New Components

- `VisitedToggle` — sidebar toggle, mirrors `FavoriteToggle`.
- `MyValley` — personalization hub modal: progress bar + Visited / Following / Trips
  subtabs (styled like the Settings subtabs).
- `TripsManager` — the trip management UI extracted from `MyTripsModal`, embedded in
  the My Valley Trips subtab and reused by the standalone modal. The standalone
  "My Trips" dropdown link is removed; trips live under My Valley.

### Wireframes

```
My Valley
██████░░░░░░░░░  23 of 371 explored

🧭 Visited (23)   ⭐ Following (8)   🗺️ Trips (3)
• Brandywine Falls   Unmark
• Ledges Overlook    Unmark
```

---

## Non-Functional Requirements

**NFR-031-1: Local-first framework**
- Reuses `createPoiIdListStore()` (frontend) and `syncPoiIdList()` (backend) per the
  User Data Framework (`docs/USER_DATA_FRAMEWORK.md`). No parallel storage/sync.

**NFR-031-2: Idempotent**
- Migration and sync re-run safely (`ON CONFLICT DO NOTHING`).

---

## Dependencies

- Depends on: Google auth (existing), spec `018-anon-user-settings`, `019-poi-subscriptions`.
- Blocks: #141 Phase 3 badge system and recommendations.

---

## Open Questions

1. Denominator counts `'point'` POIs only; should `'linear'` trails count too?
2. Visited-marker styling on the map (deferred to a follow-up).

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-30 | Initial draft |
