/**
 * CVSR Train Tracker Service (#038)
 *
 * Polls the US Fleet Tracking (USFT) REST API for the Cuyahoga Valley
 * Scenic Railroad locomotive's GPS position. Caches the latest position
 * in memory (no database) and exposes it via getTrainPositions().
 *
 * Auth: POST shared-view login with a sharing token → JWT (~30h expiry).
 * Data: GET /map/devices → single-device array with lat/lng/heading/speed.
 */

const USFT_API_URL = process.env.USFT_API_URL || 'https://hades.usft.com';
const SHARING_TOKEN = process.env.USFT_SHARING_TOKEN || '';
const POLL_INTERVAL_MS = parseInt(process.env.USFT_POLL_INTERVAL_MS, 10) || 5000;
const ACTIVE_STALE_MS = 5 * 60 * 1000;
const IDLE_STALE_MS = 24 * 60 * 60 * 1000;
const JWT_REFRESH_MS = 24 * 60 * 60 * 1000;

let jwt = null;
let jwtTimer = null;
let pollTimer = null;
let position = null;
let pool = null;

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

    if (!SHARING_TOKEN) {
      console.log('[TrainTracker] No USFT_SHARING_TOKEN configured — not starting');
      return;
    }

    await authenticate();

    const poll = async () => {
      try {
        const res = await fetch(`${USFT_API_URL}/map/devices`, {
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'User-Agent': 'RootsOfTheValley/1.0 (+https://rootsofthevalley.org)',
          },
        });

        if (res.status === 401) {
          console.log('[TrainTracker] JWT expired, re-authenticating');
          await authenticate();
          return;
        }

        if (!res.ok) {
          console.warn(`[TrainTracker] Poll failed: ${res.status}`);
          return;
        }

        const devices = await res.json();
        if (!Array.isArray(devices) || devices.length === 0) return;

        const device = devices[0];
        const loc = device.location;
        if (!loc) return;

        const lat = parseFloat(loc.latitude);
        const lng = parseFloat(loc.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const status = !device.ignition ? 'parked'
          : (device.location?.velocity || 0) > 0 ? 'active'
          : 'idle';

        position = {
          latitude: lat,
          longitude: lng,
          heading: parseInt(loc.heading, 10) || 0,
          speed: parseInt(loc.velocity, 10) || 0,
          status,
          updatedAt: loc.lastUpdated || new Date().toISOString(),
        };
      } catch (err) {
        console.warn(`[TrainTracker] Poll error: ${err.message}`);
      }
    };

    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);

    jwtTimer = setInterval(async () => {
      try {
        await authenticate();
      } catch (err) {
        console.warn(`[TrainTracker] JWT refresh failed: ${err.message}`);
      }
    }, JWT_REFRESH_MS);
  } catch (err) {
    console.error('[TrainTracker] Failed to start:', err.message);
  }
}

export function stopTrainTracker() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (jwtTimer) { clearInterval(jwtTimer); jwtTimer = null; }
  jwt = null;
  console.log('[TrainTracker] Stopped');
}

export function getTrainPositions() {
  if (!position) {
    return { cvsr: null };
  }

  const age = Date.now() - new Date(position.updatedAt).getTime();
  const threshold = position.status === 'active' ? ACTIVE_STALE_MS : IDLE_STALE_MS;
  if (age > threshold) {
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
