# Implementation Plan: Day-Trip Planning

> **Spec ID:** 017-day-trip-planning
> **Status:** Planning
> **Last Updated:** 2026-05-18
> **Estimated Effort:** L

## Summary

Add a `trips` + `trip_stops` schema, a `/api/trips` route module owning CRUD + featured/duplicate, a React `TripContext` that owns the trip-in-progress with localStorage sync, and four new frontend components (`AddToTripButton`, `TripBuilder`, `MyTripsModal`, `TripPermalink`). The multi-stop Google Maps handoff already works (`NavigateButton.buildGoogleMapsUrl`) — this feature feeds it longer arrays and adds persistence.

---

## Architecture

### Data flow — building a trip

```
1. User taps "+ Add to Trip" in Sidebar POI Info
2. AddToTripButton calls TripContext.addStop({poi_id, lat, lng, label})
3. TripContext appends to in-memory stops + writes localStorage
4. TripBuilder dock re-renders with the new ordered list
5. Map re-renders numbered markers from trip.stops
6. "Open in Google Maps" → buildGoogleMapsUrl(stops) → window.open(url)
```

### Data flow — saving a trip

```
1. User taps "Save Trip" in TripBuilder
2. TripContext.saveTrip() → POST /api/trips with {name, stops, is_public, is_featured}
3. Server validates, generates slug, inserts trip + trip_stops in a transaction
4. Returns {id, slug, ...}. TripContext clears localStorage trip-in-progress, holds the saved trip in memory
5. MyTripsModal (if open) re-fetches /api/trips/mine
```

### Data flow — opening a Featured Trip

```
1. User opens MyTripsModal → taps "+ Add Featured Trip"
2. Modal fetches /api/trips/featured
3. User selects one → POST /api/trips/:id/duplicate
4. Server clones into caller's account with is_featured=false, name+" (copy)"
5. Modal re-fetches /api/trips/mine, shows the new clone
```

---

## Implementation Steps

### Phase 1: Backend
- [ ] Add `054_add_trips.sql` migration
- [ ] Add `backend/routes/trips.js` exporting `createTripsRouter(pool)`
- [ ] Add slug helper (new `backend/utils/slug.js` if no existing util)
- [ ] Mount router in `backend/server.js`
- [ ] Add `backend/tests/trips.integration.test.js`

### Phase 2: Frontend foundation
- [ ] Add `frontend/src/contexts/TripContext.jsx` (state, localStorage sync, API client)
- [ ] Add a `useTrip()` hook in `frontend/src/hooks/useTrip.js`
- [ ] Wrap `<App />` (or its children) in `<TripProvider>`

### Phase 3: Frontend components
- [ ] Add `AddToTripButton.jsx` and insert it into `Sidebar.jsx` after the existing `<NavigateButton />`
- [ ] Add `TripBuilder.jsx` + CSS; render at App level
- [ ] Add `MyTripsModal.jsx` + CSS; wire to a new "My Trips" item in the App.jsx user-menu dropdown
- [ ] Add `TripPermalink.jsx` for `/trip/:slug`; add the route in App.jsx
- [ ] Render numbered `divIcon` markers in `Map.jsx` for `trip.stops` when active

### Phase 4: Build, verify, ship
- [ ] `./run.sh build` (must pass)
- [ ] `./run.sh start`
- [ ] Walk Scott through the verification checklist in this plan
- [ ] `./run.sh test`
- [ ] `git push -u origin feature/366-day-trip-planning`
- [ ] `gh pr create` (Closes #366)
- [ ] `./run.sh gatehouse` (fall back to single-shot Gemini Pro on rate-limit)
- [ ] Triage findings with Scott; fix or justify

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/054_add_trips.sql` | Schema for `trips` + `trip_stops` |
| `backend/routes/trips.js` | `createTripsRouter(pool)` factory with CRUD + featured + duplicate |
| `backend/utils/slug.js` | Slug generation helper (if no existing util) |
| `backend/tests/trips.integration.test.js` | Supertest integration coverage |
| `frontend/src/contexts/TripContext.jsx` | Current trip-in-progress, localStorage sync, API client |
| `frontend/src/hooks/useTrip.js` | Hook over `TripContext` |
| `frontend/src/components/AddToTripButton.jsx` | Badge for POI Info row |
| `frontend/src/components/TripBuilder.jsx` (+ `.css`) | Slide-up dock |
| `frontend/src/components/MyTripsModal.jsx` (+ `.css`) | Saved trips + Featured picker |
| `frontend/src/components/TripPermalink.jsx` | Route handler for `/trip/:slug` |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | Mount `app.use('/api/trips', createTripsRouter(pool))` near the other routers (~line 168) |
| `frontend/src/App.jsx` | Wrap in `<TripProvider>`, render `<TripBuilder />`, add `/trip/:slug` route, add "My Trips" item to the inline user dropdown |
| `frontend/src/components/Sidebar.jsx` | Add `<AddToTripButton ... />` after `<NavigateButton ... />` at line ~295 |
| `frontend/src/components/Map.jsx` | Render numbered `divIcon` markers for `trip.stops` when a trip is active |

---

## Reused utilities

| Existing | Used for |
|---|---|
| `buildGoogleMapsUrl(stops)` in `NavigateButton.jsx` | Multi-waypoint URL |
| `getNavigationStops(poi, isLinearFeature)` in `Sidebar.jsx` | Coordinate resolution + nav override fallback for Add-to-Trip eligibility |
| `useAuth()` (`hooks/useAuth.js`) | Drives Save-Trip enablement, admin-only `Feature this` checkbox |
| `isAuthenticated`, `isAdmin`, `optionalAuth` middleware (`backend/middleware/auth.js`) | Route authorization |
| `createFeedbackRouter(pool)` factory pattern (`backend/routes/feedback.js`) | Template for `createTripsRouter` |
| `divIcon` pattern in `Map.jsx` (~lines 746/756) | Numbered stop markers |

---

## Testing Strategy

### Integration tests (Vitest + Supertest) — `backend/tests/trips.integration.test.js`

- Create a trip; assert response includes slug + stops in order
- POST as a non-admin with `is_featured: true` → response has `is_featured: false`
- POST as admin with `is_featured: true` → response has `is_featured: true`
- GET `/api/trips/featured` returns only `is_featured = true` trips
- GET `/api/trips/:slug` for a private trip as a non-owner → 404
- GET `/api/trips/:slug` for a `is_public` trip as an anonymous user → 200
- PUT owner-only enforcement
- DELETE owner-only enforcement
- POST `/api/trips/:id/duplicate` copies stops in order with `is_featured = false`
- Max stops: 25 accepted, 26 rejected
- Slug collision: two trips with the same name get distinct slugs

### Manual browser verification

(Same checklist as in spec — Scott walks through in his browser before PR.)

---

## Rollback Plan

If issues are discovered after merge but before deploy:
1. Revert the merge commit on master
2. Migration `054_add_trips.sql` is additive (CREATE TABLE IF NOT EXISTS); it can be left in place — leaving empty tables in the DB has no runtime cost

If issues are discovered after deploy:
1. Revert and redeploy
2. Optional: `DROP TABLE trip_stops; DROP TABLE trips;` against prod if a re-do migration would conflict (unlikely — only on a major schema change)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Google Maps URL length exceeds browser limits with 25 stops | Med | Soft warning at 10 stops, hard cap at 25; tested URL ≤ 2KB stays well under |
| `localStorage` quota or corruption | Low | Trip-in-progress data is < 4 KB; wrap reads in try/catch and clear on parse error |
| Non-admin sets `is_featured: true` via direct API | Med | Server silently coerces to `false`; integration test covers it |
| POI deletion orphans trip stops | Low | `ON DELETE SET NULL` on `poi_id`; cached lat/lng + label keep the stop usable |
| Slug collision | Low | Short random hash suffix on the kebab-case slug; UNIQUE constraint + retry loop on insert |
| Adding `TripProvider` regresses other rendering paths | Med | Manual verification step covers the main map + existing features; integration test for `headerButtons` already exists |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-18 | Initial plan |
