import { createLogger } from '../utils/logger.js';

const logger = createLogger('Egress');

/**
 * Per-domain egress for the scrapers (admin setting `egress_routes`).
 *
 * Every scraper leaves through the ExpressVPN proxy (PLAYWRIGHT_PROXY) unless
 * the domain is listed here. Some sites reset every connection from ExpressVPN's
 * address range, so they get another route:
 *   - direct:      lotor's own IP (the shared browser's proxy bypass list)
 *   - expressvpn:  the default, for unlisted domains
 *   - residential: a residential proxy (RESIDENTIAL_PROXY, per browser context);
 *                  falls back to expressvpn while that is unset
 *
 * The setting is a JSON object, e.g. {"newfranklin.org": "direct"}. An entry
 * covers the domain and its subdomains; the longest matching entry wins.
 */

export const ROUTES = ['direct', 'expressvpn', 'residential'];
const DEFAULT_ROUTE = 'expressvpn';
const CACHE_MS = 60 * 1000;

let routes = {};
let loadedAt = 0;
let loading = null; // in-flight loadEgressRoutes query, shared by concurrent callers
let warnedNoResidential = false;

/**
 * Parse the setting value into {domain: route}, dropping malformed entries.
 * @param {string|null|undefined} value - The raw admin_settings value
 * @returns {Record<string, string>}
 */
export function parseEgressRoutes(value) {
  if (!value) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    logger.error(`egress_routes is not valid JSON: ${err.message}`);
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.error('egress_routes must be a JSON object of domain to route');
    return {};
  }
  const result = {};
  for (const [rawDomain, route] of Object.entries(parsed)) {
    const domain = String(rawDomain).trim().toLowerCase().replace(/^\*?\./, '');
    if (!domain) continue;
    if (!ROUTES.includes(route)) {
      logger.warn(`egress_routes: unknown route '${route}' for ${domain}; using ${DEFAULT_ROUTE}`);
      continue;
    }
    result[domain] = route;
  }
  return result;
}

/**
 * Refresh the cached routes from admin_settings (at most once a minute).
 * Concurrent callers share one query. A read failure keeps the last good routes
 * and waits out the same minute before retrying.
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string, string>>}
 */
export async function loadEgressRoutes(pool) {
  if (Date.now() - loadedAt < CACHE_MS) return routes;
  loading ??= (async () => {
    try {
      const res = await pool.query("SELECT value FROM admin_settings WHERE key = 'egress_routes'");
      routes = parseEgressRoutes(res.rows[0]?.value);
    } catch (err) {
      logger.error(`Failed to load egress_routes: ${err.message}`);
    }
    loadedAt = Date.now();
  })().finally(() => { loading = null; });
  await loading;
  return routes;
}

/** Test hook: replace the cached routes (fresh for a minute). */
export function setEgressRoutes(value) {
  routes = value;
  loadedAt = Date.now();
  warnedNoResidential = false;
}

/** Test hook: empty the cache so the next loadEgressRoutes reads the database. */
export function resetEgressRoutes() {
  routes = {};
  loadedAt = 0;
  warnedNoResidential = false;
}

/**
 * The route for a URL: the longest listed domain that is the host or a parent of it.
 * @param {string} url
 * @param {Record<string, string>} [table] - Defaults to the cached routes
 * @returns {'direct'|'expressvpn'|'residential'}
 */
export function routeFor(url, table = routes) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return DEFAULT_ROUTE;
  }
  let best = null;
  for (const domain of Object.keys(table)) {
    if ((host === domain || host.endsWith(`.${domain}`)) && (!best || domain.length > best.length)) {
      best = domain;
    }
  }
  return best ? table[best] : DEFAULT_ROUTE;
}

/**
 * Chromium --proxy-bypass-list for the domains routed direct: each domain and its
 * subdomains. A subdomain listed under another route is not carved back out.
 * @param {Record<string, string>} [table] - Defaults to the cached routes
 * @returns {string} Comma-separated rules, '' when none
 */
export function directBypassList(table = routes) {
  return Object.entries(table)
    .filter(([, route]) => route === 'direct')
    .flatMap(([domain]) => [domain, `.${domain}`])
    .join(',');
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
  const proxy = { server: `${url.protocol}//${url.host}` };
  if (url.username) proxy.username = decodeURIComponent(url.username);
  if (url.password) proxy.password = decodeURIComponent(url.password);
  return proxy;
}

/**
 * The route actually usable: residential falls back to expressvpn (with one
 * warning) while RESIDENTIAL_PROXY is unset.
 * @param {string} route
 * @returns {'direct'|'expressvpn'|'residential'}
 */
export function effectiveRoute(route) {
  if (route !== 'residential' || process.env.RESIDENTIAL_PROXY) return route;
  if (!warnedNoResidential) {
    logger.warn('egress_routes lists residential domains but RESIDENTIAL_PROXY is unset; using expressvpn');
    warnedNoResidential = true;
  }
  return DEFAULT_ROUTE;
}
