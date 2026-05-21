# Specification: POI Subscriptions, Notifications & Personalized Digest

> **Spec ID:** 019-poi-subscriptions
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-20

## Overview

Lets visitors favorite ("subscribe to") individual POIs and stay informed when
new news or events appear at those places. Subscriptions drive three surfaces: a
Facebook-style in-app notification bell with an unread badge and a feed, a
Favorites section in Settings that aggregates news/events from subscribed POIs,
and a per-user customized weekly email digest scoped to a logged-in user's
favorited POIs. Concrete, user-requested subset of the UX 1.0 plan (#141, Phases
2 and 4); validates real demand from Robbie Schneider's feedback (#213).

**Anonymous-first:** following a POI and the notification bell work for
not-logged-in visitors too, consistent with the rest of the app's anonymous UX
(spec 018). Anonymous favorites live in localStorage and flush to the account on
first sign-in via `/api/user/settings/sync`. The bell computes unread state
**client-side** (favorited POIs' recent content vs. a last-seen timestamp), so
there is no server-side notifications table or fan-out job — the same code path
serves anonymous and logged-in users. The personalized weekly email remains a
logged-in feature (it needs a server-side account + email).

---

## User Stories

### Subscribing to POIs

**US-001: Favorite a POI**
> As a signed-in user, I want to favorite a POI from its detail panel so that I can track it.

Acceptance Criteria:
- [ ] A star/subscribe toggle appears in the POI detail panel for authenticated users
- [ ] Anonymous users see the toggle but are prompted to sign in when they click it
- [ ] Toggling on/off persists immediately and reflects current state on reload
- [ ] Favoriting is idempotent (double-add does not error or duplicate)

### In-app notifications

**US-002: Notification bell with unread badge**
> As a subscriber, I want a notification bell in the header showing an unread count so that I know when there's new activity at my POIs.

Acceptance Criteria:
- [ ] A bell icon appears in the header for authenticated users
- [ ] An unread-count badge shows when there are unread notifications (capped display, e.g. "9+")
- [ ] The count refreshes periodically and after the feed is opened

**US-003: Notification feed**
> As a subscriber, I want to open a feed of notifications so that I can see what's new and jump to it.

Acceptance Criteria:
- [ ] Opening the bell shows a dropdown/list of recent notifications, newest first
- [ ] Each notification names the POI and the new news/event and links to it
- [ ] Opening the feed (or clicking a notification) marks notifications read; the badge clears
- [ ] A notification is created only once per (user, content item)

### Favorites in Settings

**US-004: Favorites section aggregates content**
> As a subscriber, I want a Favorites section in Settings that lists my subscribed POIs and their recent news/events so that I have one place to catch up.

Acceptance Criteria:
- [ ] A new "Favorites" tab appears in Settings for authenticated users
- [ ] It lists the user's favorited POIs with a way to unsubscribe
- [ ] It shows aggregated recent news and upcoming events from those POIs
- [ ] Empty state guides the user to favorite POIs from the map

### Personalized email digest

**US-005: Customized weekly email**
> As a subscriber, I want my weekly email digest scoped to my favorited POIs so that the email is relevant to me.

Acceptance Criteria:
- [ ] Users with favorites receive a personalized weekly email covering only their POIs' news/events
- [ ] Users without favorites continue to receive the existing general broadcast unchanged
- [ ] The personalized email reuses the existing digest visual style
- [ ] If a user's favorited POIs have no content that week, they are skipped (no empty email)

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `user_poi_favorites` | Join table: which logged-in user subscribes to which POI, with timestamp. Source of truth for logged-in favorites; also backs the personalized email. |

There is **no** server-side notifications table: unread state is computed
client-side. Anonymous favorites live in browser localStorage (`rotv-favorites`)
until the user signs in.

### Schema Changes

```sql
CREATE TABLE IF NOT EXISTS user_poi_favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poi_id     INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, poi_id)
);

-- Backfill favorites from the legacy array column (idempotent)
INSERT INTO user_poi_favorites (user_id, poi_id)
SELECT u.id, p
FROM users u, UNNEST(u.favorite_destinations) AS p
WHERE p IS NOT NULL
ON CONFLICT DO NOTHING;
```

The legacy `users.favorite_destinations` array is retained but no longer the
source of truth; `/auth/user` derives `favorites` from `user_poi_favorites`.

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/favorites` | List the current user's favorited POIs (id, name) | User |
| POST | `/api/favorites/:poiId` | Subscribe to a POI (idempotent) | User |
| DELETE | `/api/favorites/:poiId` | Unsubscribe from a POI | User |
| GET | `/api/notifications/feed` | Recent news + upcoming events for favorited POIs. Logged-in: server favorites. Anonymous: `?pois=1,2,3`. | Optional |
| POST | `/api/user/settings/sync` | (extended) Flushes anonymous favorites to `user_poi_favorites` on sign-in | User |

Unread counts and read state are computed client-side from `/api/notifications/feed`
plus a `rotv-notifications-last-seen` localStorage timestamp — no server endpoints.

---

## UI/UX Requirements

### New Components

- `FavoriteToggle` — star/subscribe button in the POI detail panel; prompts sign-in when anonymous
- `NotificationBell` — header bell with unread badge and dropdown feed
- Favorites tab content inside `UserSettings.jsx` — favorited POI list + aggregated feed

### Wireframes

```
Header:  [logo] ............................. [🔔3] [user ▼]
                                                │
                                                ▼ dropdown feed
                                          ┌──────────────────────────┐
                                          │ New event at Boston Mill  │
                                          │ New article at Stanford   │
                                          │ ...                       │
                                          └──────────────────────────┘

Settings tabs:  [ General ] [ Favorites ] [ Newsletter ]
                              └─ favorited POI list (★ to remove)
                                 + recent news / upcoming events
```

---

## Non-Functional Requirements

**NFR-001: Idempotency & no duplicate notifications**
- Favoriting and the fan-out job are idempotent; `UNIQUE (user_id, content_type, content_id)` prevents duplicate notifications across job re-runs/retries.

**NFR-002: Migrations re-run safely**
- All migrations use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` (run on every container start).

**NFR-003: Notification lag**
- New content surfaces in the bell within ~1 hour (fan-out job cadence). Not real-time.

**NFR-004: Email scale**
- Per-user sends are bounded by the number of subscribers with favorites; acceptable at current scale. Skip users with no new content.

---

## Dependencies

- Depends on: existing auth (Passport sessions), `poi_news`/`poi_events`, Buttondown digest infra, pg-boss job scheduler
- Relates to: #141 (UX 1.0), #213 (this request)

---

## Open Questions

1. Notification retention — should read notifications older than N days be pruned? (Deferred; can add a cleanup job later.)
2. Should the personalized email cover the same windows as the broadcast (events Fri–Sun, news last 7 days)? Assumed yes for consistency.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-20 | Initial draft |
| 0.2.0 | 2026-05-20 | Anonymous-first: favorites + bell work logged-out (localStorage + sync). Unified on client-side unread; removed server `user_notifications` table and hourly fan-out job in favor of public `/api/notifications/feed`. Header: Map/Results collapsed into one toggle, anon login shown as a dot, bell visible to all (mobile space). |
