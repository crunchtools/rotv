/**
 * CVSR Train Tracker Service (#038)
 *
 * Polls the US Fleet Tracking (USFT) REST API for the Cuyahoga Valley
 * Scenic Railroad locomotive's GPS position. Caches the latest position
 * in memory (no database) and exposes it via getTrainPositions().
 *
 * Auth: POST shared-view login with a sharing token → JWT (~30h expiry).
 * Data: GET /map/devices → single-device array with lat/lng/heading/speed.
 *
 * Resilience (#038 follow-up, 2026-07-10 outage): the poll loop starts
 * unconditionally and authenticates lazily inside pollOnce() with retry on
 * every cycle. A transient auth/network failure at startup (e.g. egress not
 * ready right after an app restart) therefore self-heals within one interval
 * instead of killing the tracker until the next restart. getTrainPositions()
 * also serves null once polling has gone stale, so a silently-dead poller
 * surfaces as "no data" (and to monitoring) rather than a frozen marker.
 */

const USFT_API_URL = process.env.USFT_API_URL || 'https://hades.usft.com';
const SHARING_TOKEN = process.env.USFT_SHARING_TOKEN || '';
const POLL_INTERVAL_MS = parseInt(process.env.USFT_POLL_INTERVAL_MS, 10) || 5000;
const JWT_REFRESH_MS = 24 * 60 * 60 * 1000;
// Serve null once we haven't had a successful device fetch in this long. Well
// above the poll interval so a couple of transient failures don't blank the
// train, but low enough that a dead poller is caught quickly by monitoring.
const STALE_MS = parseInt(process.env.USFT_STALE_MS, 10) || 5 * 60 * 1000;

let jwt = null;
let pollTimer = null;
let jwtTimer = null;
let position = null;
let lastPollOkAt = 0;   // server clock (ms) of the last successful device fetch
let lastError = null;
let pool = null;
let enabled = false;

async function authenticate() {
  const res = await fetch(`${USFT_API_URL}/auth/login/shared-view`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'RootsOfTheValley/1.0 (+https://rootsofthevalley.org)',
    },
    body: JSON.stringify({ token: SHARING_TOKEN }),
  });

  if (!res.ok) {
    throw new Error(`USFT auth failed: ${res.status} ${res.statusText}`);
  }

  const authResponse = await res.json();
  jwt = authResponse.token;
  console.log('[TrainTracker] Authenticated with USFT');
}

// One poll cycle. Authenticates lazily, fetches the device, updates position.
// NEVER throws — the interval keeps calling it, so failures retry and self-heal.
// Exported for tests.
export async function pollOnce() {
  try {
    if (!jwt) await authenticate();

    const res = await fetch(`${USFT_API_URL}/map/devices`, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'User-Agent': 'RootsOfTheValley/1.0 (+https://rootsofthevalley.org)',
      },
    });

    if (res.status === 400 || res.status === 401) {
      console.log(`[TrainTracker] Auth rejected (${res.status}), re-authenticating`);
      jwt = null;
      await authenticate();
      return;
    }

    if (!res.ok) {
      lastError = `poll failed: ${res.status}`;
      console.warn(`[TrainTracker] Poll failed: ${res.status}`);
      return;
    }

    const devices = await res.json();
    if (!Array.isArray(devices) || devices.length === 0) {
      lastError = 'no devices returned';
      return;
    }

    const device = devices[0];
    const loc = device.location;
    if (!loc) {
      lastError = 'device has no location';
      return;
    }

    const lat = parseFloat(loc.latitude);
    const lng = parseFloat(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      lastError = 'device has invalid coordinates';
      return;
    }

    const status = !device.ignition ? 'parked'
      : (loc.velocity || 0) > 0 ? 'active'
      : 'idle';

    position = {
      latitude: lat,
      longitude: lng,
      heading: parseInt(loc.heading, 10) || 0,
      speed: parseInt(loc.velocity, 10) || 0,
      status,
      updatedAt: loc.lastUpdated || new Date().toISOString(),
    };
    lastPollOkAt = Date.now();
    lastError = null;
  } catch (err) {
    // Network error or auth throw. Leave jwt as-is (a 401 path already cleared
    // it); the next cycle retries. Do not rethrow — that would stop nothing here
    // but keeps the invariant that the loop is the only thing that can fail.
    lastError = err.message;
    console.warn(`[TrainTracker] Poll error: ${err.message}`);
  }
}

export async function startTrainTracker(dbPool) {
  pool = dbPool;
  if (!pool) return;

  try {
    const setting = await pool.query(
      `SELECT value FROM admin_settings WHERE key = 'live_train_tracker_enabled'`
    );
    if (setting.rows[0]?.value === 'false') {
      console.log('[TrainTracker] Disabled via admin setting — not starting');
      return;
    }
  } catch (err) {
    // A DB hiccup at boot must not prevent the tracker from starting.
    console.warn(`[TrainTracker] Could not read admin setting, proceeding: ${err.message}`);
  }

  if (!SHARING_TOKEN) {
    console.log('[TrainTracker] No USFT_SHARING_TOKEN configured — not starting');
    return;
  }

  enabled = true;

  // Start the poll loop unconditionally. pollOnce() authenticates lazily and
  // retries every cycle, so no single startup failure can kill the tracker.
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  pollOnce();

  // Proactively refresh the JWT so we rarely hit a mid-poll 401.
  if (jwtTimer) clearInterval(jwtTimer);
  jwtTimer = setInterval(() => {
    authenticate().catch(err => console.warn(`[TrainTracker] JWT refresh failed: ${err.message}`));
  }, JWT_REFRESH_MS);

  console.log('[TrainTracker] Started (self-healing poll loop)');
}

export function stopTrainTracker() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (jwtTimer) { clearInterval(jwtTimer); jwtTimer = null; }
  jwt = null;
  position = null;
  lastPollOkAt = 0;
  lastError = null;
  enabled = false;
  console.log('[TrainTracker] Stopped');
}

function isStale() {
  return !lastPollOkAt || (Date.now() - lastPollOkAt) > STALE_MS;
}

export function getTrainPositions() {
  if (!position || isStale()) {
    return { cvsr: null };
  }

  return {
    cvsr: {
      latitude: position.latitude,
      longitude: position.longitude,
      heading: position.heading,
      speed: position.speed,
      status: position.status,
      updatedAt: position.updatedAt,
    },
  };
}

// Liveness for monitoring: distinguishes "tracker dead/stale" from "train
// simply parked" (a parked train still returns a fresh position). Consumed by
// GET /api/health/trackers.
export function getTrainStatus() {
  const ageSeconds = lastPollOkAt ? Math.round((Date.now() - lastPollOkAt) / 1000) : null;
  return {
    enabled,
    running: pollTimer != null,
    hasPosition: position != null,
    // "Serving fresh data." A dead poll loop trips this within STALE_MS even if
    // `running` still reports a timer; `running` is exposed separately so a
    // check can also alert on the loop never having started.
    healthy: position != null && !isStale(),
    lastPollOkAt: lastPollOkAt ? new Date(lastPollOkAt).toISOString() : null,
    ageSeconds,
    lastError,
  };
}
