# Implementation Plan: POI Subscriptions, Notifications & Personalized Digest

> **Spec ID:** 019-poi-subscriptions
> **Status:** Planning
> **Last Updated:** 2026-05-20
> **Estimated Effort:** L

## Summary

Add a `user_poi_favorites` join table and a `user_notifications` table; expose
`/api/favorites` and `/api/notifications` user-scoped routers; generate
notifications with an hourly pg-boss fan-out job; add a personalized weekly email
alongside the existing broadcast; and add a `FavoriteToggle`, header
`NotificationBell`, and a Favorites tab in Settings on the frontend.

---

## Architecture

### Data Flow

1. User clicks the star in a POI detail panel → `POST /api/favorites/:poiId` → row in `user_poi_favorites`.
2. Collection/moderation publishes news/events as it does today (no change).
3. Hourly `NOTIFICATION_FANOUT` pg-boss job: for each favorite, find published `poi_news`/`poi_events` newer than the favorite's `created_at` and newer than the last fan-out watermark, `INSERT ... ON CONFLICT DO NOTHING` into `user_notifications`.
4. `NotificationBell` polls `GET /api/notifications/unread-count`; opening it loads `GET /api/notifications` and calls `POST /api/notifications/read`.
5. Friday digest job: existing broadcast for everyone as today; **then** for each subscriber-with-favorites, generate a POI-scoped digest and send via `sendDraftToRecipients`.

### Watermark

The fan-out job stores a per-run watermark in `job_logs` (reuse existing
pattern) or a small settings row; content is considered "new" when its
`created_at` (news: `collection_date`; events: `collection_date`) is after the
last successful fan-out and after the user's favorite `created_at`. The UNIQUE
constraint is the real safety net; the watermark just bounds the scan.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Favorites store | Postgres join table | Clean joins for fan-out and feed; per-row timestamps |
| Notification engine | pg-boss scheduled job | Decoupled from publish paths; idempotent via UNIQUE |
| Personalized email | Buttondown `sendDraftToRecipients` | Reuses existing client; per-recipient targeting already supported |
| Bell polling | Interval fetch (~60s) + on-open | Simple; no websocket infra needed |

---

## Implementation Steps

### Phase 1: Data + favorites API
- [ ] Migration `058_add_poi_subscriptions.sql` (both tables + backfill)
- [ ] `backend/routes/favorites.js` — `createFavoritesRouter(pool)` with GET/POST/DELETE + `/feed`
- [ ] Register router in `server.js`; update `/auth/user` to read favorites from join table

### Phase 2: Notifications API + fan-out job
- [ ] `backend/routes/notifications.js` — list, unread-count, read
- [ ] `backend/services/notificationService.js` — `fanOutNotifications(pool)`
- [ ] Register `NOTIFICATION_FANOUT` job type + hourly schedule in `jobScheduler.js`

### Phase 3: Personalized email
- [ ] `generatePersonalizedDigest(pool, userId, tz)` in `newsletterDigestService.js`
- [ ] `sendPersonalizedDigests(pool)` — loop subscribers-with-favorites, skip empties
- [ ] Hook into the existing Friday digest job after the broadcast

### Phase 4: Frontend
- [ ] `FavoriteToggle` in POI detail panel; wire to `/api/favorites`, update AuthContext favorites
- [ ] `NotificationBell` in header with badge + dropdown feed
- [ ] Favorites tab in `UserSettings.jsx` consuming `/api/favorites` + `/api/favorites/feed`

### Phase 5: Tests + verification
- [ ] Supertest coverage for favorites + notifications routers
- [ ] Unit test for `fanOutNotifications` idempotency
- [ ] `./run.sh build` + browser verification

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/058_add_poi_subscriptions.sql` | Tables + backfill |
| `backend/routes/favorites.js` | Favorites + feed endpoints |
| `backend/routes/notifications.js` | Notification endpoints |
| `backend/services/notificationService.js` | Fan-out logic |
| `frontend/src/components/FavoriteToggle.jsx` | Subscribe star |
| `frontend/src/components/NotificationBell.jsx` | Header bell + feed |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | Register favorites + notifications routers |
| `backend/routes/auth.js` | `/auth/user` favorites from join table |
| `backend/services/jobScheduler.js` | Register + schedule `NOTIFICATION_FANOUT`; call personalized digests in Friday job |
| `backend/services/newsletterDigestService.js` | Personalized digest generation + send loop |
| `frontend/src/components/UserSettings.jsx` | Favorites tab |
| `frontend/src/components/<POI detail panel>` | Mount `FavoriteToggle` |
| `frontend/src/<header component>` | Mount `NotificationBell` |

---

## Testing Strategy

### Integration Tests
- [ ] `POST/DELETE /api/favorites/:poiId` toggles and is idempotent; 401 when anonymous
- [ ] `GET /api/favorites/feed` returns only favorited POIs' published content
- [ ] notifications list/unread-count/read lifecycle

### Unit Tests
- [ ] `fanOutNotifications` creates one notification per new item, none on re-run

### Manual Testing
1. Sign in, favorite a POI from detail panel, reload — star stays on
2. Insert/publish a news item at a favorited POI, run fan-out — bell shows badge
3. Open bell — feed lists it, badge clears
4. Favorites tab lists POI + content; unsubscribe removes it
5. Trigger personalized digest preview — email scoped to favorited POIs

---

## Rollback Plan

1. Tables are additive; drop `user_notifications` / `user_poi_favorites` if needed (favorites also still mirrored in legacy array until cutover).
2. Unschedule `NOTIFICATION_FANOUT`; remove personalized digest call to revert to broadcast-only.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Duplicate notifications on job retry | Med | `UNIQUE (user_id, content_type, content_id)` + `ON CONFLICT DO NOTHING` |
| Per-user email volume grows | Low | Bounded at current scale; skip empties; revisit if subscriber count spikes |
| Backfill double-counts favorites | Low | `ON CONFLICT DO NOTHING`; migration idempotent |
| Notification spam on first run | Med | Only notify on content newer than the favorite's `created_at` |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-20 | Initial plan |
| 2026-05-20 | Pivot to anonymous-first + client-side unread (see spec 0.2.0). Removed `user_notifications` table, `notificationService.js` fan-out, and the `NOTIFICATION_FANOUT` job. Added public `GET /api/notifications/feed`, anon favorites in `anonSettings.js` + sync, centralized favorites in `AuthContext` (`toggleFavorite`). Header: Map/Results toggle, login dot, bell for all. |
