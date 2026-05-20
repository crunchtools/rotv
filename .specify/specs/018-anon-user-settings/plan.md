# Implementation Plan: Anonymous User Settings & Tour Accessibility

> **Spec ID:** 018-anon-user-settings
> **Status:** Planning
> **Last Updated:** 2026-05-19
> **Estimated Effort:** L (large — single bundled PR, ~10–15h focused work)

## Summary

Ungate `/settings` for anon visitors, render a reduced `UserSettings` (timezone, newsletter) for them, back the newsletter email and Trip Planner saved trips with `localStorage`, and add a single `/api/user/settings/sync` endpoint that flushes any local state to the backend on first successful login (server-wins for non-empty fields). The GuidedTour `useEffect` refactor (already committed locally) fixes the step-3 flicker for both the main tour and the trip tour.

---

## Architecture

### Data flow — anon visitor

```
[Anon visitor]
    │
    ├─ /settings → render <UserSettings user=null />
    │                  ├─ General: timezone (already localStorage)
    │                  └─ Newsletter: email field (localStorage), POST /api/newsletter/subscribe (anon OK)
    │
    ├─ + Add to Trip → tripStore in-memory state (unchanged)
    │
    └─ Save trip → write to localStorage["rotv-saved-trips"]
                   (My Trips menu visible when ≥1 local trip)
```

### Data flow — anon visitor signs up

```
OAuth redirect /?auth=success
    │
AuthContext fetchUser() succeeds
    │
    ▼
syncAnonSettings() (new helper)
    │
    ├─ POST /api/user/settings/sync { timezone, newsletter, trips }
    │
    ▼
Backend `/api/user/settings/sync` (server-wins, fill gaps):
    │  • users.timezone IS NULL → set
    │  • newsletter_subscriptions: insert if not exists
    │  • trips: insert (per-trip) if no existing trip with same slug for user
    │
    ▼
Client clears synced localStorage keys
```

---

## Implementation Steps

### Phase 1 — GuidedTour flicker (already done)
- [x] Refactor `GuidedTour.jsx` useEffect to use refs for `step`, `onStepAction`, `applyPosition`. Effect deps reduce to `[currentStep, isMobile]`. Fixes step-3 flicker for both tours.

### Phase 2 — Ungate /settings & reduce UserSettings for anon
- [ ] Remove the `useEffect` in `App.jsx` (~line 402) that bounces anon users off `/settings` to `/view`.
- [ ] Keep the existing `isAdmin ? <admin nav> : <UserSettings>` branch — anon users now render `<UserSettings user={null} />`.
- [ ] `UserSettings.jsx` — wrap the General-tab Profile section (email field, Privacy Policy link) in `{user && (...)}`. Timezone selector remains; it already reads/writes localStorage.

### Phase 3 — Newsletter email persistence
- [ ] Add `frontend/src/utils/anonSettings.js` — `readEmail()`, `writeEmail(v)`, `clearEmail()`, `readSubscribed()`, `writeSubscribed(b)`. All wrap `localStorage` with try/catch (private mode safe).
- [ ] `UserSettings.jsx` Newsletter form — init email from `user?.email ?? anonSettings.readEmail()`. On change, if no user, call `anonSettings.writeEmail()`. On successful subscribe, call `anonSettings.writeSubscribed(true)`.

### Phase 4 — LocalStorage saved trips
- [ ] Extend `anonSettings.js` with `readTrips()`, `writeTrips(arr)`, `addTrip(t)`, `removeTrip(slug)`, `clearTrips()`.
- [ ] `TripBuilder.jsx` (handleSave at line 35):
  - When `isAuthenticated`: existing POST `/api/trips` flow.
  - When anon: persist to `anonSettings.addTrip({ name, description, slug, stops })` and show same success UX. Remove the `disabled={!isAuthenticated || saving}` gate (keep saving disable). Update tooltip copy.
- [ ] `MyTripsModal.jsx`: when anon, source trip list from `anonSettings.readTrips()` instead of `GET /api/trips`. Hide "Find Trips" (public/featured) tab for anon — or keep but read-only; pick the smaller surface.
- [ ] `App.jsx` user-menu rendering (~line 1764): show `.my-trips-menu-item` whenever `isAuthenticated || anonSettings.readTrips().length > 0`. Trip-tour step 5 selector remains valid.

### Phase 5 — Backend sync endpoint
- [ ] Migration `057_add_user_timezone.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;`
- [ ] New route `backend/routes/userSettings.js`: `POST /api/user/settings/sync` (requires auth via existing middleware). Server-wins fill-gaps for `timezone`; idempotent `INSERT INTO newsletter_subscriptions ... ON CONFLICT DO NOTHING`; per-trip insert only if no trip with that slug exists for this user.
- [ ] Wire into `server.js` (mirroring trips/newsletter routes).

### Phase 6 — Sync-on-signup hook
- [ ] `frontend/src/contexts/AuthContext.jsx`:
  - In the `?auth=success` handler (line 36), after `fetchUser()` resolves with a user, call `syncAnonSettings()`.
  - `syncAnonSettings()` lives in `anonSettings.js`. Gathers all localStorage state, POSTs to `/api/user/settings/sync`, clears synced keys on success. Idempotent — calling on a user with no anon data is a no-op.

### Phase 7 — Build, browser verify, commit, review
- [ ] `./run.sh build`
- [ ] Browser verify: incognito → main tour to step 11, trip tour to step 5, build a trip → sign in → confirm trip & email subscription synced.
- [ ] Browser verify: existing logged-in user — no regressions in UserSettings, TripBuilder, MyTripsModal.
- [ ] Commit per phase OR one bundled commit (Scott's preference noted in memory: bundled PRs preferred for refactors in this area).
- [ ] Gatehouse / Gemini review; fix findings.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `.specify/specs/018-anon-user-settings/spec.md` | This spec (done) |
| `.specify/specs/018-anon-user-settings/plan.md` | This plan (done) |
| `frontend/src/utils/anonSettings.js` | localStorage helpers + `syncAnonSettings()` |
| `backend/routes/userSettings.js` | `/api/user/settings/sync` endpoint |
| `backend/migrations/057_add_user_timezone.sql` | timezone column on users |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/App.jsx` | Remove anon→/view redirect; tweak my-trips-menu-item visibility |
| `frontend/src/components/UserSettings.jsx` | Hide Profile section for anon; use anonSettings for email |
| `frontend/src/components/TripBuilder.jsx` | Anon Save → localStorage; remove auth gate on Save button |
| `frontend/src/components/MyTripsModal.jsx` | Read local trips when anon |
| `frontend/src/components/GuidedTour.jsx` | Already done — useEffect refs (flicker fix) |
| `frontend/src/contexts/AuthContext.jsx` | Call `syncAnonSettings()` after auth=success |
| `backend/server.js` | Mount new userSettings router |

---

## Database Migrations

```sql
-- 057_add_user_timezone.sql
-- Per-user timezone preference. Anon visitors set this in localStorage; on
-- first sign-in, the sync endpoint fills this column if currently NULL
-- (server-wins on subsequent syncs).
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;
```

No trip schema changes needed — the existing `trips` + `trip_stops` schema already accepts a `user_id`-scoped insert. The anon-trip JSON shape mirrors what `POST /api/trips` already accepts.

---

## API Implementation

### `POST /api/user/settings/sync` (Auth required)

**Request:**
```json
{
  "timezone": "America/New_York",
  "newsletter": { "email": "user@example.com", "subscribed": true },
  "trips": [
    { "name": "Towpath Highlights", "slug": "towpath-highlights-...",
      "description": null,
      "stops": [ { "position": 1, "poi_id": 123, "label": null,
                   "latitude": 41.27, "longitude": -81.55 }, ... ] }
  ]
}
```

**Response:** `200 OK` with `{ synced: { timezone: bool, newsletter: bool, trips: number } }`.

**Logic (server-wins fill-gaps):**
1. If `timezone` provided AND `users.timezone IS NULL`: update.
2. If `newsletter.email` provided: existing newsletter subscribe path (idempotent server-side).
3. For each trip: lookup `SELECT id FROM trips WHERE user_id = $1 AND slug = $2`. If none, INSERT the trip + its trip_stops. If found, skip (don't overwrite).

---

## Testing Strategy

### Manual (Mandatory)
1. Incognito → main tour end-to-end → step 11 lands on `/settings` newsletter, no flicker on step 3.
2. Incognito → trip tour end-to-end → save a trip → My Trips shows the local trip.
3. Incognito → reload after typing email → email persists.
4. Incognito → sign in → newsletter subscription and saved trip appear server-side.
5. Logged-in user (regression) → /settings, TripBuilder save, MyTripsModal — no behavior changes.
6. Re-sync (no-op) → sign out, sign back in → no duplicate trips, no errors.
7. Conflict test → set timezone server-side, then sign in with a different timezone in localStorage → server value wins.

### Automated
- Skip for this PR (per project pattern — `/deploy` runs the test suite post-merge). Manual verification is the gate.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sync clobbers existing user data | High | Server-wins fill-gaps semantics: never overwrite non-null fields; trip dedup by slug |
| LocalStorage quota errors | Low | All anonSettings writes are try/catch; saved trips are small JSON |
| Anon trip with stale POI references | Medium | trip_stops already caches lat/lng (`ON DELETE SET NULL` on poi_id); UI handles unlinked stops |
| Sync runs twice on rapid re-login | Low | Endpoint is idempotent; localStorage cleared on first success |
| Existing logged-in user regression | Medium | UserSettings for `user` truthy path is unchanged; TripBuilder anon branch only fires when `!isAuthenticated` |

---

## Rollback Plan

If issues post-deploy:
1. Revert the merge commit (single PR).
2. Database: migration is additive (`ADD COLUMN IF NOT EXISTS`) — no rollback needed.
3. LocalStorage data persists harmlessly until next session.

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-19 | Initial plan; OQs from spec resolved (OQ-1=full localStorage trips, OQ-3=auth callback, OQ-4=server-wins, OQ-5=keep copy). OQ-2 resolved by inspection — existing trips schema is reusable. |
