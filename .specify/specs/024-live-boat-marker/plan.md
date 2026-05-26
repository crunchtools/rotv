# Implementation Plan: Live Boat Marker

> **Spec ID:** 024-live-boat-marker
> **Status:** Planning
> **Last Updated:** 2026-05-25
> **Estimated Effort:** M

## Summary

Add a backend Socket.IO v2 client service that connects to TrackMyShuttle, caches the latest Harbor Hopper position in memory, and exposes it via `/api/water-taxi/position`. On the frontend, poll that endpoint every 10 seconds and render an animated boat marker on the map when the Water Taxis layer is active. The Socket.IO event name is the shuttle serial number (`78W113620299`); the org_key (`f923d2d999391c15d4325a241635cc3b`) is static, not session-specific. Heading is available as `heading_degrees`; no speed field exists.

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    ROTV Backend                         │
│                                                         │
│  ┌───────────────────────────────────┐                 │
│  │     waterTaxiTrackerService.js    │                 │
│  │  ┌─────────────────────────────┐  │                 │
│  │  │  Socket.IO v2 Client        │  │   Connects to   │
│  │  │  (EIO=3, polling→websocket) │──┼──► socket.trackmyshuttle.com
│  │  └──────────┬──────────────────┘  │                 │
│  │             │ position events      │                 │
│  │  ┌──────────▼──────────────────┐  │                 │
│  │  │  In-memory position cache   │  │                 │
│  │  │  { lat, lng, heading, ts }  │  │                 │
│  │  └──────────┬──────────────────┘  │                 │
│  └─────────────┼─────────────────────┘                 │
│                │                                        │
│  ┌─────────────▼─────────────────────┐                 │
│  │  GET /api/water-taxi/position     │◄── Frontend     │
│  └───────────────────────────────────┘    (10s poll)   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    ROTV Frontend                        │
│                                                         │
│  ┌───────────────────────────────────┐                 │
│  │  useBoatPosition() hook           │  polls every    │
│  │  → /api/water-taxi/position       │  10 seconds     │
│  └──────────┬────────────────────────┘                 │
│             │ { lat, lng, heading }                     │
│  ┌──────────▼────────────────────────┐                 │
│  │  BoatMarker component             │                 │
│  │  (animated Leaflet Marker)        │                 │
│  │  - smooth lat/lng transition      │                 │
│  │  - boat SVG icon, rotated by      │                 │
│  │    heading                        │                 │
│  │  - visible only when Water Taxis  │                 │
│  │    layer is on + position is      │                 │
│  │    fresh (< 5 min)                │                 │
│  └───────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. On server start, `waterTaxiTrackerService.js` connects to `socket.trackmyshuttle.com` via Socket.IO v2 (EIO=3).
2. TrackMyShuttle pushes position events; the service stores the latest `{lat, lng, heading, updated_at}` in a module-scoped variable.
3. `GET /api/water-taxi/position` reads the cache and returns the position (or null if stale/missing).
4. The frontend `useBoatPosition()` hook polls the endpoint every 10 seconds.
5. `BoatMarker` renders an animated Leaflet marker at the position, gated by `showWaterTaxis` and freshness.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Socket.IO client | `socket.io-client@2.x` | TrackMyShuttle uses Socket.IO v2 (EIO=3); must match protocol version |
| Position cache | Module-scoped variable | No persistence needed; ephemeral by design |
| Frontend polling | `useEffect` + `setInterval` | Simple, no WebSocket complexity on our side — position updates every ~10s are sufficient |
| Marker animation | CSS `transition` on Leaflet `DivIcon` | Smooth lat/lng movement without heavy animation libraries |

---

## Implementation Steps

### Phase 1: Backend — Socket.IO client + REST endpoint

- [ ] Install `socket.io-client@2.x` as a dependency.
- [ ] Create `backend/services/waterTaxiTrackerService.js`:
  - Connect to `socket.trackmyshuttle.com` with query `id=iframe_<org_key>&url=https://rootsofthevalley.org`.
  - Listen for event `"78W113620299"` (Harbor Hopper serial number).
  - Parse `data.response`: extract `latitude`, `longitude`, `heading_degrees`, `event_reason`.
  - Only cache position for active event reasons (`ON_PERIODIC`, `HEADING`, `IGN_ON`, `POLL`, etc.). Treat `IGN_OFF`, `POWER_CUT`, `POWER_OFF`, `end_trip=1` as offline.
  - Exponential backoff on disconnect (5s → 60s).
  - Check `live_boat_tracker_enabled` admin setting before connecting; re-check on reconnect.
  - Log connection state changes at info level; log individual positions at debug only.
- [ ] Add `GET /api/water-taxi/position` endpoint in `server.js`.
- [ ] Seed `live_boat_tracker_enabled = 'true'` in admin_settings (migration).

### Phase 2: Frontend — polling hook + animated marker

- [ ] Create `frontend/src/hooks/useBoatPosition.js`:
  - Poll `/api/water-taxi/position` every 10 seconds.
  - Return `{ position, isOnline }` — null position when stale.
  - Clean up interval on unmount.
- [ ] Create `BoatMarker` component (rendered inside `Map.jsx`):
  - Leaflet `Marker` with a boat-shaped `DivIcon` SVG.
  - CSS transition for smooth lat/lng movement.
  - Rotate icon by heading if available.
  - Only render when `showWaterTaxis` is true AND position is not null.
- [ ] Wire `useBoatPosition` into `App.jsx` → `Map.jsx`.
- [ ] Add boat icon SVG asset (`frontend/public/icons/boat-marker.svg`).

### Phase 3: Sidebar status indicator

- [ ] In `ReadOnlyView.jsx`, add a "Live" / "Offline" badge next to the Live Tracker button for Harbor Hopper.
- [ ] Pass boat position status down through sidebar props.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/services/waterTaxiTrackerService.js` | Socket.IO v2 client, position cache, start/stop lifecycle |
| `frontend/src/hooks/useBoatPosition.js` | Position polling hook |
| `frontend/public/icons/boat-marker.svg` | Boat-shaped marker icon |
| `backend/migrations/063_add_live_boat_tracker_setting.sql` | Admin setting seed |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | Import tracker service, start on boot, add `/api/water-taxi/position` endpoint |
| `backend/package.json` | Add `socket.io-client@2.x` dependency |
| `frontend/src/App.jsx` | Wire `useBoatPosition` hook, pass to Map |
| `frontend/src/components/Map.jsx` | Render `BoatMarker` component when water taxis layer is on |
| `frontend/src/components/sidebar/ReadOnlyView.jsx` | Add Live/Offline status indicator |
| `frontend/src/App.css` | Boat marker animation styles, status indicator styles |

---

## Database Migrations

```sql
-- Migration: 063_add_live_boat_tracker_setting
-- Seed the admin toggle for the Socket.IO tracker client.

INSERT INTO admin_settings (key, value, description)
VALUES ('live_boat_tracker_enabled', 'true',
        'Enable/disable the live boat position tracker (Socket.IO client to TrackMyShuttle)')
ON CONFLICT (key) DO NOTHING;
```

---

## Testing Strategy

### Manual Testing

1. Start the container; confirm the Socket.IO client connects (check logs for connection message).
2. If the boat is running (seasonal): verify the marker appears on the map at the boat's position.
3. If the boat is NOT running: verify no marker appears, no errors in console, water taxi routes work normally.
4. Toggle Water Taxis layer off — marker should disappear. Toggle on — marker reappears (if position available).
5. Set `live_boat_tracker_enabled` to `false` via admin — confirm Socket.IO client disconnects and marker disappears.
6. Kill the container's network — confirm reconnection with backoff in logs.

### Edge Cases

- Stale position (> 5 min): marker should not render.
- TrackMyShuttle returns unexpected event format: should log warning, not crash.
- Multiple rapid position updates: marker should animate smoothly, not flicker.

---

## Rollback Plan

1. Set `live_boat_tracker_enabled` to `false` — immediately disables the tracker, no restart needed.
2. The migration only adds an admin setting — safe to leave in place.
3. To fully remove: revert the commit (no schema changes to undo).

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| TrackMyShuttle changes protocol / blocks ROTV | High | Graceful degradation — marker disappears, everything else works. Admin toggle to disable. |
| Socket.IO v2 handshake requires session-specific tokens | Med | Reverse-engineer handshake during testing; fall back to HTTP polling of their position endpoint if socket fails |
| Boat is offline during development (seasonal) | Med | Build the full pipeline and test with mock positions; verify with real data when the boat starts running |
| High-frequency position events strain the backend | Low | We only cache the latest position, no accumulation. Frontend polls at 10s regardless of push frequency. |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-25 | Initial plan |
