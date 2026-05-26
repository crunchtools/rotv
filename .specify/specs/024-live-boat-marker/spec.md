# Specification: Live Boat Marker

> **Spec ID:** 024-live-boat-marker
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-25

## Overview

Add a live, animated boat marker that shows the Harbor Hopper water taxi's real-time GPS position on the map. The position is sourced from TrackMyShuttle's Socket.IO v2 feed (the same data behind `trackmyshuttle.com/a/5799`). The backend connects as a Socket.IO client, caches the latest position in memory, and exposes it via a REST endpoint. The frontend polls that endpoint and renders an animated Leaflet marker that smoothly slides along the route. When the boat is offline or the feed is unavailable, no marker appears — the existing static water taxi routes and Live Tracker button remain unaffected.

---

## User Stories

### Live Tracking

**US-024-1: See the boat's live position on the map**
> As a visitor waiting for the Harbor Hopper, I want to see where the boat is right now on the map so that I can estimate when it will arrive at my stop.

Acceptance Criteria:
- [ ] A boat-shaped marker appears on the map at the Harbor Hopper's current GPS position when the boat is active.
- [ ] The marker smoothly animates between position updates rather than jumping.
- [ ] The marker is visually distinct from POI markers and stop markers (boat icon in the water taxi teal color).

**US-024-2: Know when the boat is offline**
> As a visitor, I want to understand when the boat isn't running so that I don't wait for a marker that won't appear.

Acceptance Criteria:
- [ ] When no position has been received for > 5 minutes, no boat marker is shown.
- [ ] The water taxi sidebar shows "Currently offline" or "Position unavailable" status when the tracker feed is stale or disconnected.
- [ ] The Water Taxis layer, routes, and stops work identically whether the live feed is active or not.

**US-024-3: Graceful degradation when the feed breaks**
> As a site operator, I want the live tracker to fail silently if TrackMyShuttle changes their protocol so that the rest of the site keeps working.

Acceptance Criteria:
- [ ] If the Socket.IO connection fails or the protocol changes, the backend logs a warning and the frontend shows no marker — no errors, no broken UI.
- [ ] The live tracker can be disabled via an admin setting without restarting the service.
- [ ] No position data is stored in the database — it's ephemeral, held only in server memory.

---

## Data Model

### New Tables

None. Position data is ephemeral (held in-memory on the backend). No database storage.

### Schema Changes

None.

### Admin Settings

| Key | Default | Description |
|-----|---------|-------------|
| `live_boat_tracker_enabled` | `true` | Master on/off switch for the Socket.IO client |

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/water-taxi/position` | Returns the latest known position of tracked water taxis | No |

**Response:**
```json
{
  "harbor_hopper": {
    "latitude": 41.4958,
    "longitude": -81.7037,
    "heading": 180,
    "status": "active",
    "updatedAt": "2026-05-25T14:30:00Z"
  }
}
```

When no position is available or the data is stale (active >5 min, docked >24 hr):
```json
{
  "harbor_hopper": null
}
```

---

## UI/UX Requirements

### Boat Marker

- Boat-shaped SVG icon (similar to the water-taxis layer icon) in `#0E9E9E` teal.
- Rotates to match heading when heading data is available.
- Smooth CSS/Leaflet transition between positions (not instant jumps).
- Appears only when the Water Taxis layer is enabled AND the boat has a fresh position.
- Z-index above route lines but below tooltips.

### Sidebar Enhancement

- When a water taxi with `live_tracker_url` is selected in the sidebar, show a small "Live" / "Offline" status indicator near the Live Tracker button.

### No New Legend Items

The boat marker inherits visibility from the existing "Water Taxis" layer toggle — no separate toggle needed.

---

## Non-Functional Requirements

**NFR-024-1: Respectful polling**
- The Socket.IO client connects once and listens for push events — it does not aggressively poll.
- Frontend polls the REST endpoint at most every 10 seconds.
- If the Socket.IO connection is lost, exponential backoff before reconnecting (starting at 5s, max 60s).

**NFR-024-2: Memory-only position cache**
- No position data written to PostgreSQL. Server restart clears the cache; the marker disappears until a new position arrives.

**NFR-024-3: No PII**
- Only vessel latitude, longitude, and heading are captured. No user or operator identifiers.

**NFR-024-4: Seasonal tolerance**
- The boat doesn't run in winter. The Socket.IO client should handle months of no-data gracefully without log spam.

---

## Dependencies

- Depends on: 023-water-taxis (water taxi POIs, routes, and layer toggle must exist)
- Blocks: none

---

## Open Questions

1. ~~**Socket.IO v2 handshake details**~~ **RESOLVED:** Connection uses `io.connect('https://socket.trackmyshuttle.com/', { query: "id=iframe_f923d2d999391c15d4325a241635cc3b&url=..." })`. The org_key `f923d2d999391c15d4325a241635cc3b` is static (Cleveland Water Taxi's org ID), not session-specific. EIO=3, starts as HTTP long-polling, upgrades to WebSocket. Position events are pushed on an event named by the shuttle's hardware serial number: `78W113620299`. Payload: `data.response = { latitude, longitude, heading_degrees, event_reason, text, end_trip, ... }`. Active movement indicated by `event_reason` in `[ON_PERIODIC, HEADING, IGN_ON, POLL, ...]`; `IGN_OFF` = docked/idle; `POWER_CUT/OFF` = tracker offline.
2. ~~**Heading/speed availability**~~ **RESOLVED:** Heading is available as `heading_degrees` (integer, 0-360). No speed field in the payload.
3. ~~**eLCee2 tracking**~~ **RESOLVED (from issue):** No tracker exists for the free Metroparks boat. This spec covers Harbor Hopper only.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-25 | Initial draft |
