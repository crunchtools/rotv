/**
 * Usage analytics (#637): Umami runs inside the container on 127.0.0.1:3000
 * with BASE_PATH=/stats. Express proxies /stats/* to it so the tracker, the
 * collection endpoint and the dashboard are all first-party. Only the tracker
 * script and the collection endpoint are public; everything else needs a ROTV
 * admin session. See docs/ANALYTICS_ARCHITECTURE.md.
 */
import http from 'http';
import { isAdmin } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Analytics');

const UMAMI_HOST = '127.0.0.1';
const UMAMI_PORT = 3000;
const UMAMI_BASE = `http://${UMAMI_HOST}:${UMAMI_PORT}/stats`;
// Fixed at creation by rootfs/usr/local/bin/umami-setup.mjs
export const UMAMI_WEBSITE_ID = '804a81bc-5731-4028-bd22-2aa2f2b159c2';
const REPORT_TIMEZONE = 'America/New_York';

// Exact matches only: anything else under /stats is the dashboard
export const PUBLIC_STATS_PATHS = new Set(['/stats/script.js', '/stats/api/send']);

// Fix: retry a failed heartbeat after 5s, not 60s (PR #690 review)
// A healthy Umami is trusted for a minute; a failed probe is retried soon, so a
// restart doesn't leave new visitors untracked for long.
const PROBE_UP_TTL_MS = 60 * 1000;
const PROBE_DOWN_TTL_MS = 5 * 1000;
let probe = { at: 0, up: false };

/**
 * The website id the frontend should track against, or null. Tests never load
 * the tracker, and neither do local builds without Umami (no heartbeat).
 * UMAMI_ENABLED overrides both, so a dev container (NODE_ENV=test) can be
 * verified end to end.
 */
export async function analyticsWebsiteId() {
  if (process.env.UMAMI_ENABLED === 'false') return null;
  if (process.env.UMAMI_ENABLED !== 'true' && process.env.NODE_ENV === 'test') return null;
  if (Date.now() - probe.at >= (probe.up ? PROBE_UP_TTL_MS : PROBE_DOWN_TTL_MS)) {
    let up = false;
    try {
      up = (await fetch(`${UMAMI_BASE}/api/heartbeat`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch (err) {
      logger.warn(`Umami heartbeat failed, tracker disabled: ${err.message}`);
    }
    probe = { at: Date.now(), up };
  }
  return probe.up ? UMAMI_WEBSITE_ID : null;
}

function forward(req, res) {
  const headers = { ...req.headers };
  // The ROTV session cookie is none of Umami's business
  delete headers.cookie;
  const upstream = http.request({
    host: UMAMI_HOST,
    port: UMAMI_PORT,
    method: req.method,
    path: req.originalUrl,
    headers,
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', (err) => {
    logger.warn(`Umami unreachable for ${req.method} ${req.path}: ${err.message}`);
    if (!res.headersSent) res.status(503).json({ error: 'Analytics unavailable' });
    else res.end();
  });
  req.pipe(upstream);
}

/**
 * Express middleware for /stats. The tracker script and collector are
 * forwarded for anyone; every other path needs a ROTV admin session, and a
 * non-admin gets isAdmin's 401/403 JSON. Forwarded requests stream to Umami
 * without the ROTV cookie, and a down Umami answers 503. Terminal: never
 * calls next().
 *
 * Mount on /stats after the session/passport middleware, and exempt /stats
 * from the body parsers so the request stream reaches Umami untouched.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {void}
 */
export function statsProxy(req, res) {
  if (PUBLIC_STATS_PATHS.has(req.originalUrl.split('?')[0])) return forward(req, res);
  return isAdmin(req, res, () => forward(req, res));
}

// --- Umami API client for the admin MCP tools ---

let cachedToken = null;
// Fix: one login shared by concurrent calls; getStatsSummary fires four at once (PR #690 review)
let pendingLogin = null;

async function umamiGet(path, params, retried = false) {
  if (!cachedToken) {
    if (!process.env.UMAMI_ADMIN_PASSWORD) throw new Error('UMAMI_ADMIN_PASSWORD is not set');
    pendingLogin ??= fetch(`${UMAMI_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: process.env.UMAMI_ADMIN_PASSWORD }),
    }).then(async (login) => {
      if (!login.ok) throw new Error(`Umami login failed (${login.status})`);
      return (await login.json()).token;
    }).finally(() => { pendingLogin = null; });
    cachedToken = await pendingLogin;
  }
  const url = `${UMAMI_BASE}/api/websites/${UMAMI_WEBSITE_ID}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cachedToken}` } });
  if (res.status === 401 && !retried) {
    cachedToken = null;
    return umamiGet(path, params, true);
  }
  if (!res.ok) throw new Error(`Umami ${path} returned ${res.status}`);
  return res.json();
}

function range(days) {
  const endAt = Date.now();
  return { startAt: endAt - days * 24 * 60 * 60 * 1000, endAt };
}

async function propertyValues(eventName, propertyName, days) {
  return umamiGet('/event-data/values', { ...range(days), eventName, propertyName });
}

/**
 * Site totals for the last `days` days.
 * @param {number} days
 * @returns {Promise<{days: number, visitors: number, visits: number, pageviews: number,
 *   bounces: number, daily: {date: string, visits: number, pageviews: number}[],
 *   trackers: {clicks: {value: string, total: number}[], route_opens: {value: string, total: number}[]}}>}
 */
export async function getStatsSummary(days) {
  const window = range(days);
  const [totals, series, trackerClicks, trackerRoutes] = await Promise.all([
    umamiGet('/stats', window),
    umamiGet('/pageviews', { ...window, unit: 'day', timezone: REPORT_TIMEZONE }),
    propertyValues('tracker_click', 'vehicle', days),
    propertyValues('tracker_route_open', 'vehicle', days),
  ]);
  const pageviewsByDate = new Map((series.pageviews || []).map((p) => [p.x, p.y]));
  return {
    days,
    visitors: totals.visitors,
    visits: totals.visits,
    pageviews: totals.pageviews,
    bounces: totals.bounces,
    daily: (series.sessions || []).map((s) => ({
      date: s.x,
      visits: s.y,
      pageviews: pageviewsByDate.get(s.x) ?? 0,
    })),
    trackers: { clicks: trackerClicks, route_opens: trackerRoutes },
  };
}

/**
 * Top values over the last `days` days.
 * metric 'event'|'path'|'referrer'|'country'|'device'|'browser'|'os' returns
 * Umami metrics rows ({x, y}). metric 'property' returns the values of one
 * event property ({value, total}) and requires both `event` and `property`.
 * @param {{metric: string, days: number, limit: number, event?: string, property?: string}} args
 * @returns {Promise<object[]>}
 * @throws {Error} when metric is 'property' without event and property, or Umami fails
 */
export async function getStatsTop({ metric, days, limit, event, property }) {
  if (metric === 'property') {
    if (!event || !property) throw new Error('metric "property" needs both event and property');
    const values = await propertyValues(event, property, days);
    return values.slice(0, limit);
  }
  return umamiGet('/metrics', { ...range(days), type: metric, limit });
}
