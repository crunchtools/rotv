/**
 * Water Taxi Tracker Service (#408)
 *
 * Connects to TrackMyShuttle's Socket.IO v2 feed to receive live GPS
 * positions for the Harbor Hopper water taxi. Caches the latest position
 * in memory (no database) and exposes it via getBoatPositions().
 *
 * On startup, fetches the tracker page to seed the cache with the last
 * known position (from their saved_response JSON). This means the docked
 * marker appears immediately even if no socket event has arrived yet.
 *
 * Protocol: Socket.IO v2 (EIO=3) at socket.trackmyshuttle.com over
 * websocket (polling→ws upgrade is unstable from a server environment).
 * The event name is the shuttle's hardware serial number.
 */

import io from 'socket.io-client';

const SOCKET_URL = 'https://socket.trackmyshuttle.com/';
const TRACKER_PAGE = 'https://trackmyshuttle.com/a/5799';
const ORG_KEY = 'f923d2d999391c15d4325a241635cc3b';
const SERIAL_NUMBER = '78W113620299';
const ACTIVE_STALE_MS = 5 * 60 * 1000;

const ACTIVE_EVENTS = new Set([
  'ON_PERIODIC', 'HEADING', 'IGN_ON', 'POLL', 'POWER_UP',
  'BATT_WARN', 'IDLING', 'BEGIN_STOP', 'END_STOP', 'SPEEDING',
  'HEARTBEAT', 'IDLING_END', 'HARDSTOP', 'SPEEDING_END',
  'HARDBRAKE', 'HARDTURN', 'HARDACCEL',
]);

let socket = null;
let position = null;
let pool = null;

async function seedFromPage() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(TRACKER_PAGE, {
      headers: { 'User-Agent': 'RootsOfTheValley/1.0 (+https://rootsofthevalley.org)' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const html = await res.text();

    const latMatch = html.match(/"last_latitude"\s*:\s*([-\d.]+)/);
    const lngMatch = html.match(/"last_longitude"\s*:\s*([-\d.]+)/);
    if (!latMatch || !lngMatch) return;

    const lat = parseFloat(latMatch[1]);
    const lng = parseFloat(lngMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const headingMatch = html.match(/"last_heading"\s*:\s*([-\d]+)/);
    const heading = headingMatch ? parseInt(headingMatch[1], 10) : 0;

    const eventMatch = html.match(/"event_reason"\s*:\s*"([^"]+)"/);
    const eventReason = eventMatch ? eventMatch[1] : '';
    const status = ACTIVE_EVENTS.has(eventReason) ? 'active' : 'docked';

    position = { latitude: lat, longitude: lng, heading, status, updated_at: new Date().toISOString() };
    console.log(`[WaterTaxiTracker] Seeded from page: ${lat.toFixed(4)}, ${lng.toFixed(4)} (${status})`);
  } catch (err) {
    console.log(`[WaterTaxiTracker] Could not seed from page: ${err.message}`);
  }
}

function updatePosition(resp) {
  const lat = parseFloat(resp.latitude);
  const lng = parseFloat(resp.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const heading = parseInt(resp.heading_degrees, 10) || 0;
  const now = new Date().toISOString();
  const eventReason = resp.event_reason || '';
  const endTrip = resp.end_trip === 1 || resp.end_trip === '1';

  if (endTrip || !ACTIVE_EVENTS.has(eventReason)) {
    position = { latitude: lat, longitude: lng, heading, status: 'docked', updated_at: now };
    return;
  }

  position = { latitude: lat, longitude: lng, heading, status: 'active', updated_at: now };
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
    console.log('[WaterTaxiTracker] Connected to TrackMyShuttle');
  });

  socket.on(SERIAL_NUMBER, (data) => {
    if (data.code !== 200 || !data.response) return;
    updatePosition(data.response);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[WaterTaxiTracker] Disconnected: ${reason}`);
  });

  socket.on('reconnect', (attempts) => {
    console.log(`[WaterTaxiTracker] Reconnected after ${attempts} attempt(s)`);
  });
}

async function checkSettingAndConnect() {
  if (!pool) return;
  try {
    const result = await pool.query(
      `SELECT value FROM admin_settings WHERE key = 'live_boat_tracker_enabled'`
    );
    if (result.rows[0]?.value === 'false') {
      console.log('[WaterTaxiTracker] Disabled via admin setting — not connecting');
      return;
    }
    await seedFromPage();
    connect();
  } catch (err) {
    console.error('[WaterTaxiTracker] Failed to check admin setting:', err.message);
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
  console.log('[WaterTaxiTracker] Stopped');
}

export function getBoatPositions() {
  if (!position) {
    return { harbor_hopper: null };
  }

  if (position.status === 'active') {
    const age = Date.now() - new Date(position.updated_at).getTime();
    if (age > ACTIVE_STALE_MS) {
      return { harbor_hopper: null };
    }
  }

  return {
    harbor_hopper: {
      latitude: position.latitude,
      longitude: position.longitude,
      heading: position.heading,
      status: position.status,
      updated_at: position.updated_at,
    },
  };
}
