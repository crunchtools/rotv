import { isRoute, normalizeDomain, invalidateEgressConfig } from './egressRoutes.js';

/**
 * Admin side of Network Routes (Settings › Data Collection, MCP egress tools):
 * read the overview, pin or reset a domain, change the default route and the
 * IPRoyal daily cap. The crawler side lives in egressRoutes.js.
 */

// Measured on newfranklin.org with images, fonts and stylesheets blocked (#800).
const ESTIMATED_MB_PER_RENDER = 0.6;

/**
 * Invalid Network Routes input (unknown domain, route or cap). Thrown by
 * setDomainRoute and setEgressSettings before anything is written; the admin
 * API answers it with 400 and MCP with an error result.
 */
export class EgressValidationError extends Error {}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<object>} defaultRoute, residentialConfigured, residentialCap, usage, routes
 */
export async function getEgressOverview(pool) {
  const [settings, routes, usage] = await Promise.all([
    pool.query("SELECT key, value FROM admin_settings WHERE key IN ('egress_default_route', 'egress_residential_daily_cap')"),
    pool.query(`SELECT domain, route, source, last_ok_at, last_blocked_at, last_error, updated_at
                  FROM egress_domain_routes ORDER BY domain`),
    pool.query(`SELECT route,
                       COALESCE(SUM(renders) FILTER (WHERE day = CURRENT_DATE), 0)::int AS today,
                       COALESCE(SUM(renders), 0)::int AS last30
                  FROM egress_usage WHERE day > CURRENT_DATE - 30 GROUP BY route`)
  ]);
  const byKey = Object.fromEntries(settings.rows.map(r => [r.key, r.value]));
  return {
    defaultRoute: isRoute(byKey.egress_default_route) ? byKey.egress_default_route : 'expressvpn',
    residentialConfigured: Boolean(process.env.RESIDENTIAL_PROXY),
    residentialCap: parseInt(byKey.egress_residential_daily_cap, 10) || 0,
    estimatedMbPerRender: ESTIMATED_MB_PER_RENDER,
    usage: Object.fromEntries(usage.rows.map(r => [r.route, { today: r.today, last30: r.last30 }])),
    routes: routes.rows.map(r => ({
      domain: r.domain, route: r.route, source: r.source, lastOkAt: r.last_ok_at,
      lastBlockedAt: r.last_blocked_at, lastError: r.last_error, updatedAt: r.updated_at
    }))
  };
}

/**
 * Pin a domain to a route (manual), or reset it to the default with route 'default'.
 * @param {import('pg').Pool} pool
 * @param {string} rawDomain
 * @param {string} route - expressvpn | direct | residential | default
 * @param {number|null} userId
 * @returns {Promise<{domain: string, route: string}>}
 */
export async function setDomainRoute(pool, rawDomain, route, userId = null) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) throw new EgressValidationError(`Not a domain: ${rawDomain}`);
  if (route === 'default') {
    await pool.query('DELETE FROM egress_domain_routes WHERE domain = $1', [domain]);
  } else if (isRoute(route)) {
    await pool.query(
      `INSERT INTO egress_domain_routes (domain, route, source, updated_at, updated_by)
       VALUES ($1, $2, 'manual', NOW(), $3)
       ON CONFLICT (domain) DO UPDATE SET route = EXCLUDED.route, source = 'manual',
         updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
      [domain, route, userId]
    );
  } else {
    throw new EgressValidationError(`Route must be expressvpn, direct, residential or default (got ${route})`);
  }
  invalidateEgressConfig();
  return { domain, route };
}

/**
 * Change the default route and/or the IPRoyal daily render cap.
 * @param {import('pg').Pool} pool
 * @param {{defaultRoute?: string, residentialCap?: number}} changes
 * @param {number|null} userId
 */
export async function setEgressSettings(pool, { defaultRoute, residentialCap }, userId = null) {
  const updates = [];
  if (defaultRoute !== undefined) {
    if (!isRoute(defaultRoute)) throw new EgressValidationError(`Default route must be expressvpn, direct or residential (got ${defaultRoute})`);
    updates.push(['egress_default_route', defaultRoute]);
  }
  if (residentialCap !== undefined) {
    const cap = Number(residentialCap);
    if (!Number.isInteger(cap) || cap < 0 || cap > 100000) throw new EgressValidationError('IPRoyal daily cap must be a whole number from 0 to 100000');
    updates.push(['egress_residential_daily_cap', String(cap)]);
  }
  for (const [key, value] of updates) {
    await pool.query(
      `INSERT INTO admin_settings (key, value, updated_at, updated_by) VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
      [key, value, userId]
    );
  }
  invalidateEgressConfig();
}
