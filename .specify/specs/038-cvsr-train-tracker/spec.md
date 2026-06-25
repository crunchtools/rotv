# Specification: CVSR Live Train Tracker

> **Spec ID:** 038-cvsr-train-tracker
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty / Josui
> **Date:** 2026-06-24

## Overview

Add live GPS tracking for the Cuyahoga Valley Scenic Railroad (CVSR) train on the ROTV map, using the same architectural pattern as the Harbor Hopper water taxi tracker. The backend polls the US Fleet Tracking (USFT) API to get the locomotive's position, caches it in memory, and the frontend renders a moving train icon on the map. A `?feature=CVSR` URL flag gates visibility so the feature can be demoed to CVSR stakeholders before public launch.

---

## User Stories

### Live Train Position

**US-038-1: See the CVSR train on the map**
> As a Towpath Trail user, I want to see the CVSR train's live position on the map so that I can time my bike-aboard pickup at the nearest station.

Acceptance Criteria:
- [ ] A train icon appears on the map showing the locomotive's current GPS position
- [ ] The icon rotates to reflect the train's heading
- [ ] The icon visually distinguishes between active (moving) and idle (parked) states
- [ ] Position updates every 10 seconds (matching the GPS ping interval)
- [ ] When the train hasn't moved for >5 minutes, it shows as "idle" with a muted icon
- [ ] When no data is available (train off, GPS down), no icon is shown

**US-038-2: View train details in sidebar**
> As a user, I want to click the train marker to see the CVSR's info in the sidebar so that I can learn about the railroad and its schedule.

Acceptance Criteria:
- [ ] Clicking the train marker opens the CVSR POI in the sidebar
- [ ] The sidebar shows the train's current status (active/idle) and last update time
- [ ] The existing "Live Tracker" button links to the USFT page as a fallback

### Feature Flag

**US-038-3: Gate feature behind URL flag for partner demo**
> As the product owner, I want the train tracker hidden by default and only visible when `?feature=CVSR` is in the URL so that I can demo it to CVSR stakeholders without exposing it publicly.

Acceptance Criteria:
- [ ] The train tracker (marker, legend entry, toggle) is hidden by default
- [ ] Appending `?feature=CVSR` to any ROTV URL enables the train tracker for that session
- [ ] The feature flag persists in localStorage so the user doesn't need the param on every page load
- [ ] The flag can be cleared by visiting `?feature=CVSR&off=true` or clearing localStorage
- [ ] When the feature is ready for public launch, removing the flag check enables it for everyone

### Legend and Toggle

**US-038-4: Toggle train visibility in the legend**
> As a user (with the feature enabled), I want a "Train" toggle in the map legend so that I can show or hide the train marker.

Acceptance Criteria:
- [ ] A train toggle appears in the Transit section of the legend (next to Water Taxis)
- [ ] The toggle controls visibility of the train marker on the map
- [ ] The toggle is only present when the CVSR feature flag is active (or after public launch)

---

## Data Model

### No New Tables

The train position is cached in backend memory (same as Harbor Hopper). No database tables needed.

### POI Seed Data

The CVSR already exists as a POI in the database. The existing `live_tracker_url` column will be populated with the USFT shared view URL.

```sql
UPDATE pois SET live_tracker_url = 'https://www.lvgps.net/view/gzr9jEzIiHPd5c71ZfUv6uaFCN3rsf-kAts08dBEZPgMzyqR'
WHERE name ILIKE '%Cuyahoga Valley Scenic Railroad%';
```

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/train/position` | Returns cached CVSR train position | No |

### Response Format

```json
{
  "cvsr": {
    "latitude": 41.3678,
    "longitude": -81.6141,
    "heading": 174,
    "speed": 14,
    "status": "active",
    "updatedAt": "2026-06-24T22:17:28Z"
  }
}
```

Returns `{ "cvsr": null }` when no position is available or data is stale.

---

## External API (USFT)

### Auth Flow

1. **POST** `https://hades.usft.com/auth/login/shared-view`
   - Body: `{"token":"gzr9jEzIiHPd5c71ZfUv6uaFCN3rsf-kAts08dBEZPgMzyqR"}`
   - Returns: `{"token":"<jwt>", "options":{...}}`
   - JWT expires in ~30 hours

2. **GET** `https://hades.usft.com/map/devices`
   - Header: `Authorization: Bearer <jwt>`
   - Returns: array of device objects (single device for CVSR)

### Device Response Fields Used

| Field | Usage |
|-------|-------|
| `location.latitude` | Map marker position |
| `location.longitude` | Map marker position |
| `location.heading` | Icon rotation (degrees, 0=north) |
| `location.velocity` | Speed display; 0 = idle detection |
| `ignition` | Whether engine is on (true/false) |
| `lastMoved` | Stale detection |
| `location.lastUpdated` | Freshness timestamp |

### Polling Strategy

- Poll `GET /map/devices` every 10 seconds (matches device ping interval)
- Cache JWT in memory; refresh on 401 or proactively every 24 hours
- On failure, log warning and continue serving last known position

---

## Backend Service

### New File: `backend/services/trainTrackerService.js`

Follows the same pattern as `waterTaxiTrackerService.js`:

- `startTracker(pool)` — authenticates with USFT, begins polling
- `stopTracker()` — stops polling
- `getTrainPositions()` — returns cached position object
- JWT lifecycle managed internally (refresh on 401 or timer)

### Status Logic

| Condition | Status |
|-----------|--------|
| `ignition === true` AND `velocity > 0` | `active` |
| `ignition === true` AND `velocity === 0` | `idle` |
| `ignition === false` | `parked` |
| No data or stale >24h | `null` (hidden) |

### Admin Setting

Add `live_train_tracker_enabled` admin setting (default `true`) mirroring `live_boat_tracker_enabled`. Allows disabling the backend polling without a deploy.

---

## Frontend

### New Hook: `frontend/src/hooks/useTrainPosition.js`

Same pattern as `useBoatPosition.js`:
- Polls `GET /api/train/position` every 10 seconds
- Returns `trainPosition` object or `null`

### Feature Flag: `frontend/src/utils/featureFlags.js`

```javascript
// Check URL params on load, persist to localStorage
export function isFeatureEnabled(flag) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('feature') === flag) {
    if (params.get('off') === 'true') {
      localStorage.removeItem(`feature_${flag}`);
      return false;
    }
    localStorage.setItem(`feature_${flag}`, 'true');
    return true;
  }
  return localStorage.getItem(`feature_${flag}`) === 'true';
}
```

### Map Changes (Map.jsx)

- New `createTrainIcon(heading, status)` function (train SVG icon, rotated by heading)
- Render train `<Marker>` when `showTrains && trainPosition` (same pattern as boat marker)
- Train icon: custom SVG or use USFT's icon at `https://static.usfleettracking.com/img/icons/trains/train.png`

### Legend Changes

- Add "Trains" toggle in Transit section, gated by `isFeatureEnabled('CVSR')`

---

## Non-Functional Requirements

**NFR-038-1: Performance**
- Backend polling must not block the event loop (use `setInterval` + `fetch`, no socket needed)
- Frontend polling adds one lightweight API call every 10 seconds (same as boat tracker)

**NFR-038-2: Resilience**
- JWT refresh failures must not crash the service
- If USFT API is down, continue serving stale data until threshold, then return null
- Log warnings on failure; don't spam error logs

**NFR-038-3: Security**
- The USFT sharing token is a secret (grants read access to train position) — store in environment variable, not in code
- The `?feature=CVSR` flag is not a security boundary — it's a UX gate for controlled rollout

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `USFT_SHARING_TOKEN` | USFT shared-view token | (required) |
| `USFT_API_URL` | USFT API base URL | `https://hades.usft.com` |
| `USFT_POLL_INTERVAL_MS` | Polling interval | `10000` |

---

## Dependencies

- Depends on: 023-water-taxis (established POI role and live tracker pattern)
- Depends on: 024-live-boat-marker (established marker rendering pattern)
- CVSR POI must already exist in the database

---

## Open Questions

1. ~~**Multiple locomotives?**~~ — Resolved: single GPS tracker, mounted on one of the cars (not the locomotive). Only one device will ever be in the feed.
2. ~~**Seasonal hours**~~ — Resolved: filed as a separate cross-cutting issue for both train and boat trackers.
3. ~~**Train icon design**~~ — Resolved: use USFT's train icon (`https://static.usfleettracking.com/img/icons/trains/train.png`).

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06-24 | Initial draft — API reverse-engineered, feature flag requirement added |
