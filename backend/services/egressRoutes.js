import { createLogger } from '../utils/logger.js';

const logger = createLogger('Egress');

/**
 * Network routes for the scrapers: which way each site's requests leave lotor.
 *
 *   - expressvpn:  the ExpressVPN proxy (PLAYWRIGHT_PROXY); the usual default
 *   - direct:      lotor's own IP, no proxy
 *   - residential: IPRoyal residential proxy (RESIDENTIAL_PROXY); paid per GB
 *
 * The default route is the admin setting `egress_default_route`. Per-domain
 * entries live in `egress_domain_routes`; an entry covers the domain and its
 * subdomains, and the longest match wins:
 *   - manual: an admin's choice, pinned. No failover.
 *   - auto:   learned by renderPage when a blocked render succeeded on a
 *             fallback route. An auto IPRoyal entry expires after a week so the
 *             free routes get another try.
 * Failover tries the domain's current route, then the others cheapest first,
 * IPRoyal always last and only while it is configured and under the daily cap
 * (`egress_residential_daily_cap`, counted in `egress_usage`).
 */

const ROUTES = ['expressvpn', 'direct', 'residential']; // cost order: residential last
const FALLBACK_DEFAULT = 'expressvpn';
const DEFAULT_CAP = 100;
const CACHE_MS = 60 * 1000;
const RESIDENTIAL_AUTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Chromium net errors that mean the site refused this egress, not that it is down
// or missing. Timeouts are included: some sites drop a blocked IP silently.
const BLOCK_REASON_RE = /ERR_(CONNECTION_CLOSED|CONNECTION_RESET|EMPTY_RESPONSE|HTTP2_PROTOCOL_ERROR|SSL_PROTOCOL_ERROR|TUNNEL_CONNECTION_FAILED|CONNECTION_TIMED_OUT|TIMED_OUT)\b/;

let config = { defaultRoute: FALLBACK_DEFAULT, cap: DEFAULT_CAP, entries: {} };
let loadedAt = 0;
let loading = null; // in-flight load, shared by concurrent callers
let generation = 0; // bumped by invalidation; a load started before it doesn't publish

/** @param {unknown} route @returns {boolean} */
export function isRoute(route) {
  return ROUTES.includes(route);
}

/**
 * The domain a URL's entry is filed under: its hostname without a leading www.
 * @param {string} url
 * @returns {string|null}
 */
export function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Normalize an admin-typed domain ("https://www.Example.org/x" → "example.org").
 * @param {string} raw
 * @returns {string|null} null when it is not a plausible hostname
 */
export function normalizeDomain(raw) {
  const host = String(raw || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^\*?\./, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/**
 * Refresh the cached routes from the database (at most once a minute). A read
 * failure keeps the last good config and waits out the same minute.
 * @param {import('pg').Pool} pool
 */
export async function loadEgressConfig(pool) {
  if (Date.now() - loadedAt < CACHE_MS) return config;
  loading ??= (async () => {
    const startedAt = generation;
    try {
      const [settings, rows] = await Promise.all([
        pool.query("SELECT key, value FROM admin_settings WHERE key IN ('egress_default_route', 'egress_residential_daily_cap')"),
        pool.query('SELECT domain, route, source, updated_at FROM egress_domain_routes')
      ]);
      const byKey = Object.fromEntries(settings.rows.map(r => [r.key, r.value]));
      const cap = parseInt(byKey.egress_residential_daily_cap, 10);
      if (startedAt !== generation) return; // invalidated mid-load: leave it stale so the next call reloads
      config = {
        defaultRoute: isRoute(byKey.egress_default_route) ? byKey.egress_default_route : FALLBACK_DEFAULT,
        cap: Number.isInteger(cap) && cap >= 0 ? cap : DEFAULT_CAP,
        entries: Object.fromEntries(rows.rows.filter(r => isRoute(r.route)).map(r => [r.domain, {
          route: r.route, source: r.source, updatedAt: new Date(r.updated_at).getTime()
        }]))
      };
    } catch (err) {
      logger.error(`Failed to load network routes: ${err.message}`);
    }
    if (startedAt === generation) loadedAt = Date.now();
  })().finally(() => { loading = null; });
  await loading;
  return config;
}

/** Drop the cache so the next load reads the database (after a write). */
export function invalidateEgressConfig() {
  loadedAt = 0;
  generation++;
}

/** Test hook: set the cached config (fresh for a minute). */
export function setEgressConfig({ defaultRoute = FALLBACK_DEFAULT, cap = DEFAULT_CAP, entries = {} } = {}) {
  config = { defaultRoute, cap, entries };
  loadedAt = Date.now();
}

/** Test hook: empty the cache. */
export function resetEgressConfig() {
  config = { defaultRoute: FALLBACK_DEFAULT, cap: DEFAULT_CAP, entries: {} };
  loadedAt = 0;
}

function matchEntry(url, entries) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  // Walk the host's suffixes, longest first: the most specific entry wins, and a
  // lookup costs the host's depth, not the number of entries.
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const domain = labels.slice(i).join('.');
    if (Object.hasOwn(entries, domain)) return { domain, ...entries[domain] };
  }
  return null;
}

function entryRoute(entry, now) {
  if (!entry) return null;
  if (entry.source === 'auto' && entry.route === 'residential' && now - entry.updatedAt > RESIDENTIAL_AUTO_TTL_MS) return null;
  return entry.route;
}

/**
 * The routes to try for a URL, in order.
 * @param {string} url
 * @param {object} [cfg] - Defaults to the cached config
 * @returns {{domain: string|null, pinned: boolean, entry: object|null, chain: string[]}}
 */
export function routePlan(url, cfg = config, now = Date.now()) {
  const entry = matchEntry(url, cfg.entries);
  const domain = entry?.domain ?? domainOf(url);
  if (entry?.source === 'manual') return { domain, pinned: true, entry, chain: [entry.route] };
  const start = entryRoute(entry, now) ?? cfg.defaultRoute;
  return { domain, pinned: false, entry, chain: [start, ...ROUTES.filter(r => r !== start)] };
}

/**
 * The single route for plain requests (proxyFetch): no failover.
 * @param {string} url
 * @returns {'expressvpn'|'direct'|'residential'}
 */
export function currentRoute(url, cfg = config) {
  const route = routePlan(url, cfg).chain[0];
  return route === 'residential' && !process.env.RESIDENTIAL_PROXY ? FALLBACK_DEFAULT : route;
}

/**
 * Whether a render failed because the site refused this egress.
 * @param {{reachable?: boolean, reason?: string, blocked?: boolean}} result
 */
export function isBlocked(result) {
  if (!result) return false;
  if (result.blocked) return true;
  return result.reachable === false && BLOCK_REASON_RE.test(result.reason || '');
}

/**
 * Reserve one IPRoyal render under today's cap. The check and the count are one
 * statement, so concurrent renders can't all slip under the cap. A reserved render
 * is already counted (don't countRender it again).
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>} false when unconfigured, at the cap, or usage can't be read
 */
export async function reserveResidential(pool) {
  if (!process.env.RESIDENTIAL_PROXY || config.cap <= 0) return false;
  try {
    const res = await pool.query(
      `INSERT INTO egress_usage (day, route, renders) VALUES (CURRENT_DATE, 'residential', 1)
       ON CONFLICT (day, route) DO UPDATE SET renders = egress_usage.renders + 1
       WHERE egress_usage.renders < $1
       RETURNING renders`,
      [config.cap]
    );
    return res.rows.length > 0;
  } catch (err) {
    logger.warn(`IPRoyal reservation failed, skipping it: ${err.message}`);
    return false;
  }
}

/**
 * Count one render attempt for the usage report.
 * @param {import('pg').Pool} pool
 * @param {string} route
 */
export async function countRender(pool, route) {
  await pool.query(
    `INSERT INTO egress_usage (day, route, renders) VALUES (CURRENT_DATE, $1, 1)
     ON CONFLICT (day, route) DO UPDATE SET renders = egress_usage.renders + 1`,
    [route]
  ).catch(err => logger.warn(`Usage count failed: ${err.message}`));
}

/**
 * Remember how a render went, so the next crawl starts on the route that works.
 *   - Success on the default with an auto entry: the block lifted; drop the entry.
 *   - Success on any other route (not pinned): store it as the auto route.
 *   - Every route blocked: flag the domain (keeps a pinned route as it is).
 * @param {import('pg').Pool} pool
 * @param {ReturnType<typeof routePlan>} plan
 * @param {{route: string|null, attempts: {route: string, reason: string}[]}} outcome - route is the one that worked, null if none
 */
export async function recordOutcome(pool, plan, { route, attempts }) {
  if (!plan.domain) return;
  const { domain, entry, pinned } = plan;
  try {
    if (route) {
      if (pinned) {
        await pool.query('UPDATE egress_domain_routes SET last_ok_at = NOW() WHERE domain = $1', [domain]);
        return;
      }
      if (route === config.defaultRoute) {
        if (entry?.source === 'auto') {
          await pool.query("DELETE FROM egress_domain_routes WHERE domain = $1 AND source = 'auto'", [domain]);
          logger.info(`${domain}: ${route} works again; back to the default`);
          invalidateEgressConfig();
        }
        return;
      }
      if (entry?.route === route && attempts.length === 0) {
        await pool.query('UPDATE egress_domain_routes SET last_ok_at = NOW() WHERE domain = $1', [domain]);
        return;
      }
      await pool.query(
        `INSERT INTO egress_domain_routes (domain, route, source, last_ok_at, last_error, updated_at)
         VALUES ($1, $2, 'auto', NOW(), $3, NOW())
         ON CONFLICT (domain) DO UPDATE SET route = EXCLUDED.route, last_ok_at = NOW(),
           last_error = EXCLUDED.last_error, updated_at = NOW()
         WHERE egress_domain_routes.source = 'auto'`,
        [domain, route, attempts.map(a => `${a.route}: ${a.reason}`).join('; ') || null]
      );
      logger.info(`${domain}: learned route ${route}`);
      invalidateEgressConfig();
      return;
    }
    const error = attempts.map(a => `${a.route}: ${a.reason}`).join('; ').slice(0, 1000);
    await pool.query(
      `INSERT INTO egress_domain_routes (domain, route, source, last_blocked_at, last_error, updated_at)
       VALUES ($1, $2, 'auto', NOW(), $3, NOW())
       ON CONFLICT (domain) DO UPDATE SET last_blocked_at = NOW(), last_error = EXCLUDED.last_error`,
      [domain, plan.chain[0], error]
    );
    if (!entry) invalidateEgressConfig();
  } catch (err) {
    logger.warn(`Failed to record route outcome for ${domain}: ${err.message}`);
  }
}

/**
 * RESIDENTIAL_PROXY as a Playwright proxy option. Chromium does not take
 * credentials inside the server URL, so they are split out.
 * @returns {{server: string, username?: string, password?: string}|undefined}
 */
export function residentialProxy() {
  const value = process.env.RESIDENTIAL_PROXY;
  if (!value) return undefined;
  const url = new URL(value);
  // '<-loopback>': localhost goes to the proxy too, never straight to lotor's loopback.
  const proxy = { server: `${url.protocol}//${url.host}`, bypass: '<-loopback>' };
  if (url.username) proxy.username = decodeURIComponent(url.username);
  if (url.password) proxy.password = decodeURIComponent(url.password);
  return proxy;
}
