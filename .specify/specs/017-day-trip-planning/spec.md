# Specification: Day-Trip Planning (Advanced Google Maps Navigation)

> **Spec ID:** 017-day-trip-planning
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-18
> **GitHub Issue:** [#366](https://github.com/crunchtools/rotv/issues/366)
> **Builds on:** [016-poi-navigation](../016-poi-navigation/spec.md) — reuses the multi-stop `NavigateButton` interface

## Overview

Lets users build an ordered list of POIs into a saved "trip" (a day-trip plan), come back to edit or duplicate it later, and hand the entire route off to Google Maps for turn-by-turn navigation. Admins can flag any trip as **Featured**, surfacing curated routes like the Canalway Scenic Byway that every user can adopt with one tap.

The Google-Maps handoff already works for one stop (PR #374). This feature extends it to many stops, plus the persistence, sharing, and curation that turn it from a one-shot link into trip planning.

---

## User Stories

### Building a Trip (Any Visitor)

**US-017-1: Add a POI to a trip**
> As a visitor browsing ROTV, I want to tap an "Add to Trip" badge on a POI's Info tab so that I can start collecting stops for a day-trip without losing my place.

Acceptance Criteria:
- [ ] An `+ Add to Trip` badge appears in the POI Info badge row, right after Share and Navigate
- [ ] Tapping it adds the POI as a stop in the current trip-in-progress; if no trip is in progress, one is created implicitly
- [ ] When a POI is already in the current trip, the badge shows `✓ In Trip`; tapping it removes the stop
- [ ] The badge is hidden when the POI has no coordinates (same eligibility rule as the Navigate badge — reuses `getNavigationStops`)

**US-017-2: See and manage the trip in progress**
> As a visitor planning a day-trip, I want a persistent dock at the bottom of the map showing my current trip so that I can see what I've added, change the order, or remove stops.

Acceptance Criteria:
- [ ] A Trip Builder dock appears at the bottom of the map once the trip has at least one stop
- [ ] Collapsible — collapsed state shows "N stops · Open in Maps ▲"
- [ ] Expanded state shows: trip name field (editable), ordered list of stops with drag-to-reorder and `×` remove, stop count, action buttons
- [ ] The map renders numbered Leaflet markers for each stop while the dock is active
- [ ] An anonymous user's trip-in-progress is preserved across page reloads via `localStorage`

**US-017-3: Open the trip in Google Maps**
> As a visitor with a trip planned, I want to tap "Open in Google Maps" so that Google Maps opens with all my stops pre-loaded for navigation.

Acceptance Criteria:
- [ ] Open in Google Maps button uses `buildGoogleMapsUrl(stops)` from `NavigateButton.jsx`
- [ ] The resulting URL has the first stop as `origin`, the last as `destination`, and the middle stops as `waypoints` in order
- [ ] On mobile, the Google Maps app opens if installed; web falls back otherwise (inherited behavior)
- [ ] Stop count of 10+ shows a soft warning; the 26th stop is hard-rejected (Google Maps web ceiling)

### Saving Trips (Logged-In Users)

**US-017-4: Save a trip to my account**
> As a logged-in user, I want to save my trip so that I can return to it later without re-building.

Acceptance Criteria:
- [ ] "Save Trip" button is enabled only when authenticated; anonymous users see a "Sign in to save" tooltip
- [ ] Saving sends `POST /api/trips` with the name, description, public flag, and ordered stops
- [ ] On success, the trip moves from the localStorage trip-in-progress to the user's saved trips and the dock title changes from "Untitled Trip" to the saved name

**US-017-5: View, edit, duplicate, and delete my trips**
> As a logged-in user, I want a "My Trips" view so that I can manage all the day-trips I've saved.

Acceptance Criteria:
- [ ] User-menu dropdown shows a "My Trips" item (visible only when authenticated)
- [ ] Tapping it opens a modal listing the user's saved trips (name, stop count, last edited)
- [ ] Each row offers Open, Duplicate, Delete, and Copy share link
- [ ] Open replaces the current trip-in-progress with the saved trip (with a confirm if the in-progress trip has unsaved stops)
- [ ] Duplicate creates a new owned trip with " (copy)" suffix and opens it
- [ ] Delete asks for confirmation; on confirm, removes the trip server-side

**US-017-6: Share a trip with a friend**
> As a logged-in user, I want to flip a "Make shareable" toggle on a trip so that I can send the link to a friend who isn't necessarily logged in.

Acceptance Criteria:
- [ ] Each saved trip has an `is_public` toggle in its editor
- [ ] When enabled, `/trip/<slug>` is reachable by anonymous viewers
- [ ] Copy share link copies the URL to the clipboard
- [ ] When `is_public` is off, anonymous access returns 404 and the link does not work

### Featured Trips

**US-017-7: Discover curated trips**
> As a visitor or logged-in user, I want to browse admin-curated Featured Trips so that I can find suggested day-trips like the Canalway Scenic Byway.

Acceptance Criteria:
- [ ] Inside the My Trips modal there is an **+ Add Featured Trip** button
- [ ] Tapping it lists all `is_featured = true` trips with name, description, stop count
- [ ] Anonymous viewers can view the same list at `/trip/<slug>` for any Featured Trip
- [ ] Logged-in viewers can clone a Featured Trip into their own My Trips with one tap; the clone has `is_featured = false` and the user's `user_id`

**US-017-8: Admin curates a Featured Trip**
> As an admin, I want to flag a trip I built as Featured so that all users can find and adopt it — without leaving the same trip editor every user uses.

Acceptance Criteria:
- [ ] The trip editor shows a **Feature this trip** checkbox only when `user.is_admin = true`
- [ ] When checked, `is_featured` is set to `true` server-side
- [ ] Non-admin clients cannot set `is_featured = true`; the server silently ignores the field if the requester isn't admin
- [ ] Listing under "Add Featured Trip" reflects the change immediately

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `trips` | One row per saved trip. Owned by a user. May be flagged featured (admin only) and/or public (owner choice). |
| `trip_stops` | Ordered stops belonging to a trip. Stop-position is the ordering key. |

### Migration `054_add_trips.sql`

```sql
CREATE TABLE IF NOT EXISTS trips (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  slug         VARCHAR(200) UNIQUE NOT NULL,
  is_featured  BOOLEAN DEFAULT FALSE,
  is_public    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_is_featured ON trips(is_featured) WHERE is_featured = TRUE;

CREATE TABLE IF NOT EXISTS trip_stops (
  trip_id      INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  poi_id       INTEGER REFERENCES pois(id) ON DELETE SET NULL,
  label        VARCHAR(200),
  latitude     DECIMAL(10, 8) NOT NULL,
  longitude    DECIMAL(11, 8) NOT NULL,
  PRIMARY KEY (trip_id, position)
);

CREATE INDEX IF NOT EXISTS idx_trip_stops_poi_id ON trip_stops(poi_id);
```

Lat/lng are cached on the stop so a trip survives the underlying POI being renamed, moved, or deleted (FK uses `ON DELETE SET NULL`). `poi_id` is a soft link used to render the current POI name when available; `label` is a manual or fallback display name.

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/trips/featured` | none | Public list of `is_featured = true` trips |
| `GET` | `/api/trips/mine` | `isAuthenticated` | Current user's saved trips |
| `GET` | `/api/trips/:slug` | `optionalAuth` | One trip. Public if `is_featured` or `is_public`; otherwise owner-only |
| `POST` | `/api/trips` | `isAuthenticated` | Create a trip. `is_featured` silently ignored unless `req.user.is_admin`. Rate-limited (30/hr per user). |
| `PUT` | `/api/trips/:id` | `isAuthenticated` | Update a trip. Owner-only. Admin can additionally toggle `is_featured`. |
| `DELETE` | `/api/trips/:id` | `isAuthenticated` | Delete a trip. Owner-only. |
| `POST` | `/api/trips/:id/duplicate` | `isAuthenticated` | Clone a trip (any trip the caller can read) into the caller's account. New row gets `is_featured = false` and name " (copy)" suffix. |

### Request body (create / update)

```json
{
  "name": "Cuyahoga Waterfalls Tour",
  "description": "Optional",
  "is_public": false,
  "is_featured": false,
  "stops": [
    { "poi_id": 42, "latitude": 41.27, "longitude": -81.55, "label": "Brandywine Falls" },
    { "poi_id": 87, "latitude": 41.18, "longitude": -81.58, "label": null }
  ]
}
```

### Validation
- `name`: required, 1–200 chars
- `slug`: server-generated from `name` (kebab-case, ≤60 chars, suffixed with short random hash for collision safety). Not accepted in request body.
- `stops`: required, 1–25 entries (Google Maps web ceiling). Each entry needs valid finite `latitude` / `longitude`.
- `is_featured`: silently coerced to `false` if requester isn't admin

---

## UI/UX Requirements

### New Components

| Component | Purpose |
|-----------|---------|
| `AddToTripButton` | Badge in POI Info row; toggles a POI's membership in the current trip-in-progress |
| `TripBuilder` | Slide-up dock at the bottom of the map showing the trip-in-progress |
| `MyTripsModal` | Modal listing the user's saved trips + the Add Featured Trip picker |
| `TripPermalink` | Route handler for `/trip/:slug` |
| `TripContext` | React context holding the trip-in-progress, with localStorage sync |

### Modified Components

- `Sidebar.jsx` — insert `<AddToTripButton ... />` after the existing `<NavigateButton />` in the POI Info badge row (line ~295)
- `App.jsx` — wrap children in `<TripProvider>`, render `<TripBuilder />`, add "My Trips" to the inline user-menu dropdown (~line 1609), add a route for `/trip/:slug`
- `Map.jsx` — render numbered `divIcon` markers for the active trip's stops (reuse existing `divIcon` pattern at lines 746/756). No connecting polyline in v1.

### Map visualization

While a trip-in-progress has stops, the map shows numbered markers (1, 2, 3 …) at each stop's coordinates. No road-following polyline — the real road route is what Google Maps draws after the user taps Open in Google Maps.

---

## Non-Functional Requirements

**NFR-017-1: Anonymous resilience**
- Trip-in-progress persists across reloads for anonymous users via `localStorage`
- No server round-trips required to build, modify, or hand off a trip until the user explicitly saves

**NFR-017-2: Rate limiting**
- Write endpoints (POST/PUT/DELETE/duplicate) limited to 30/hr per authenticated user

**NFR-017-3: Stop limits**
- Soft warning at > 9 stops (Google Maps web preferred ceiling)
- Hard reject at > 25 stops, both client- and server-side

**NFR-017-4: Authorization edges**
- Server silently ignores `is_featured: true` from non-admin requests; never errors
- `/api/trips/:slug` returns 404 (not 403) for private trips the caller can't see, to avoid leaking existence

---

## Dependencies

- **Depends on:** `016-poi-navigation` (#365) — uses `buildGoogleMapsUrl` and `getNavigationStops`
- **Blocks:** None known

---

## Open Questions

None — all questions resolved in plan-mode discussion with Scott.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-18 | Initial draft |
