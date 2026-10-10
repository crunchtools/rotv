/**
 * Water Taxi Tracker Service (#408)
 *
 * Connects to TrackMyShuttle's Socket.IO feed to receive live GPS positions
 * for the Harbor Hopper water taxi. Caches the latest position in memory
 * (no database) and exposes it via getBoatPositions().
 *
 * On startup, fetches the rider API's route snapshot to seed the cache with
 * each on-duty shuttle's last_known_data (#701). This means the docked marker
 * appears immediately even if no socket event has arrived yet. Off duty the
 * snapshot lists no shuttles and there is nothing to seed.
 *
 * Protocol: the server at socket.trackmyshuttle.com is Socket.IO v2 (EIO=3);
 * it answers an EIO=4 handshake with v2 framing, so the client must stay on
 * socket.io-client 2.x. We go straight to websocket (polling→ws upgrade is
 * unstable from a server environment). The event name is the shuttle's
 * hardware serial number.
 */

import io from 'socket.io-client';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WaterTaxiTracker');

const SOCKET_URL = 'https://socket.trackmyshuttle.com/';
const RIDER_API_URL = process.env.TMS_RIDER_API_URL || 'https://api.trackmyshuttle.com/rider/api/v3';
const ORG_ID = process.env.TMS_ORG_ID || '5799';
const ORG_KEY = process.env.TMS_ORG_KEY || 'f923d2d999391c15d4325a241635cc3b';
const SERIAL_NUMBER = process.env.TMS_SERIAL || '78W113620299';
const ACTIVE_STALE_MS = 5 * 60 * 1000;
const DOCKED_STALE_MS = 24 * 60 * 60 * 1000;

const ACTIVE_EVENTS = new Set([
  'ON_PERIODIC', 'HEADING', 'IGN_ON', 'POLL', 'POWER_UP',
  'BATT_WARN', 'IDLING', 'BEGIN_STOP', 'END_STOP', 'SPEEDING',
  'HEARTBEAT', 'IDLING_END', 'HARDSTOP', 'SPEEDING_END',
  'HARDBRAKE', 'HARDTURN', 'HARDACCEL',
]);

let socket = null;
let position = null;
let pool = null;

function shuttleSerial(shuttle) {
  return shuttle.serial_number || shuttle.vin_no || '';
}

// The rider app feeds last_known_data to the same handler as socket events,
// so it carries latitude/longitude/heading_degrees/event_reason. The old
// tracker page used last_latitude/last_longitude/last_heading; accept those
// too, on either the shuttle or its last_known_data, in case they come back.
function snapshotToResponse(shuttle) {
  const lastKnown = shuttle.last_known_data || {};
  return {
    ...lastKnown,
    latitude: lastKnown.latitude ?? lastKnown.last_latitude ?? shuttle.last_latitude,
    longitude: lastKnown.longitude ?? lastKnown.last_longitude ?? shuttle.last_longitude,
    heading_degrees: lastKnown.heading_degrees ?? lastKnown.last_heading ?? shuttle.last_heading,
    event_reason: lastKnown.event_reason ?? shuttle.event_reason,
  };
}

/**
 * Seeds the in-memory position from GET /route-code-details, the call the rider
 * app makes on load. Only on-duty shuttles are listed, so an empty list is the
 * normal off-hours state, not an error. Exported for tests.
 *
 * @returns {Promise<void>} Never rejects: connect() must run regardless, so
 *   every failure is logged and leaves the position unset.
 */
export async function seedFromApi() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(`${RIDER_API_URL}/route-code-details?route_code=${ORG_ID}&type=2`, {
        headers: {
          'token-id': ORG_ID,
          'User-Agent': 'RootsOfTheValley/1.0 (+https://rootsofthevalley.org)',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      logger.warn(`Seed request failed: HTTP ${res.status}`);
      return;
    }

    // Unknown route codes come back HTTP 200 with code 204 "No Data Found".
    const body = await res.json();
    if (body?.code !== 200) {
      logger.warn(`Seed request rejected: code ${body?.code} ${body?.message || ''}`.trim());
      return;
    }

    const shuttles = (body.response?.shuttle_details || []).filter(Boolean);
    if (shuttles.length === 0) {
      logger.info('No shuttles on duty, nothing to seed');
      return;
    }

    const serials = shuttles.map(shuttleSerial);
    // Another boat's position would sit on the map as the Harbor Hopper, and the socket
    // only listens for SERIAL_NUMBER, so nothing would correct it.
    const shuttle = shuttles.find(s => shuttleSerial(s) === SERIAL_NUMBER);
    if (!shuttle) {
      logger.warn(`Serial ${SERIAL_NUMBER} not on duty (saw: ${serials.join(', ')}) — not seeding; set TMS_SERIAL if the boat's tracker changed`);
      return;
    }

    if (!updatePosition(snapshotToResponse(shuttle))) {
      logger.warn(`Shuttle ${shuttleSerial(shuttle)} on duty but last_known_data has no coordinates`);
      return;
    }

    logger.info(`Seeded from API: ${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)} (${position.status}) — shuttles on duty: ${serials.join(', ')}`);
  } catch (err) {
    logger.warn(`Could not seed from API: ${err.message}`);
  }
}

// Returns true when resp carried usable coordinates. updated_at is always
// "now": neither the socket payload nor last_known_data carries a fix time, so
// a seeded snapshot is served as fresh for DOCKED_STALE_MS from startup.
function updatePosition(resp) {
  const lat = parseFloat(resp.latitude);
  const lng = parseFloat(resp.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  const heading = parseInt(resp.heading_degrees, 10) || 0;
  const now = new Date().toISOString();
  const eventReason = resp.event_reason || '';
  const endTrip = resp.end_trip === 1 || resp.end_trip === '1';
  const status = endTrip || !ACTIVE_EVENTS.has(eventReason) ? 'docked' : 'active';

  position = { latitude: lat, longitude: lng, heading, status, updated_at: now };
  return true;
}

function connect() {
  if (socket) {
    socket.removeAllListeners();
    socket.close();
  }

  socket = io(SOCKET_URL, {
    query: `id=iframe_${ORG_KEY}&url=https://rootsofthevalley.org`,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 60000,
  });

  socket.on('connect', () => {
    logger.info('Connected to TrackMyShuttle');
  });

  // A v3+ client against this v2 server lands here on every attempt (#701).
  socket.on('connect_error', (err) => {
    logger.warn(`Connect error: ${err?.message || err}`);
  });

  socket.on(SERIAL_NUMBER, (message) => {
    if (message.code !== 200 || !message.response) return;
    updatePosition(message.response);
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Disconnected: ${reason}`);
  });

  socket.on('reconnect', (attempts) => {
    logger.info(`Reconnected after ${attempts} attempt(s)`);
  });
}

async function checkSettingAndConnect() {
  if (!pool) return;
  try {
    const setting = await pool.query(
      `SELECT value FROM admin_settings WHERE key = 'live_boat_tracker_enabled'`
    );
    if (setting.rows[0]?.value === 'false') {
      logger.info('Disabled via admin setting — not connecting');
      return;
    }
    await seedFromApi();
    connect();
  } catch (err) {
    logger.error('Failed to check admin setting:', err.message);
  }
}

export async function startTracker(dbPool) {
  pool = dbPool;
  await checkSettingAndConnect();
}

export function stopTracker() {
  if (socket) {
    socket.removeAllListeners();
    socket.close();
    socket = null;
  }
  position = null;
  logger.info('Stopped');
}

export function getBoatPositions() {
  if (!position) {
    return { harbor_hopper: null };
  }

  const age = Date.now() - new Date(position.updated_at).getTime();
  const threshold = position.status === 'active' ? ACTIVE_STALE_MS : DOCKED_STALE_MS;
  if (age > threshold) {
    return { harbor_hopper: null };
  }

  return {
    harbor_hopper: {
      latitude: position.latitude,
      longitude: position.longitude,
      heading: position.heading,
      status: position.status,
      updatedAt: position.updated_at,
    },
  };
}

// Liveness for monitoring (GET /api/health/trackers). healthy = we are serving
// a fresh position; getBoatPositions() already nulls out stale data.
export function getWaterTaxiStatus() {
  const healthy = getBoatPositions().harbor_hopper != null;
  return {
    connected: socket != null && socket.connected === true,
    hasPosition: position != null,
    healthy,
    updatedAt: position?.updated_at || null,
  };
}
