/**
 * Network routes (egressRoutes.js): which way each site's requests leave lotor,
 * the failover order, and what the crawler learns from a blocked render.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  routePlan, currentRoute, isBlocked, normalizeDomain, residentialProxy, reserveResidential,
  recordOutcome, loadEgressConfig, setEgressConfig, resetEgressConfig
} from '../services/egressRoutes.js';

const savedResidential = process.env.RESIDENTIAL_PROXY;
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  if (savedResidential === undefined) delete process.env.RESIDENTIAL_PROXY;
  else process.env.RESIDENTIAL_PROXY = savedResidential;
  resetEgressConfig();
  vi.useRealTimers();
});

const cfg = (entries = {}, defaultRoute = 'expressvpn') => ({ defaultRoute, cap: 100, entries });

describe('routePlan', () => {
  it('starts on the default and fails over cheapest first, IPRoyal last', () => {
    expect(routePlan('https://stanhywet.org/events', cfg()).chain).toEqual(['expressvpn', 'direct', 'residential']);
    expect(routePlan('https://stanhywet.org/events', cfg({}, 'direct')).chain).toEqual(['direct', 'expressvpn', 'residential']);
  });

  it('pins a manual route with no failover', () => {
    const plan = routePlan('https://www.newfranklin.org/1222', cfg({ 'newfranklin.org': { route: 'direct', source: 'manual', updatedAt: Date.now() } }));
    expect(plan).toMatchObject({ domain: 'newfranklin.org', pinned: true, chain: ['direct'] });
  });

  it('starts on a learned route and keeps the others as fallbacks', () => {
    const plan = routePlan('https://www.cvsr.org/excursions', cfg({ 'cvsr.org': { route: 'residential', source: 'auto', updatedAt: Date.now() } }));
    expect(plan).toMatchObject({ domain: 'cvsr.org', pinned: false, chain: ['residential', 'expressvpn', 'direct'] });
  });

  it('expires a learned IPRoyal route after a week so the free routes get retried', () => {
    const now = Date.now();
    const entries = { 'cvsr.org': { route: 'residential', source: 'auto', updatedAt: now - 8 * DAY } };
    expect(routePlan('https://cvsr.org/', cfg(entries), now).chain).toEqual(['expressvpn', 'direct', 'residential']);
    entries['cvsr.org'].source = 'manual';
    expect(routePlan('https://cvsr.org/', cfg(entries), now).chain).toEqual(['residential']);
  });

  it('matches subdomains, prefers the most specific entry, and ignores look-alikes', () => {
    expect(routePlan('https://a.b.example.org/', cfg({ 'example.org': { route: 'direct', source: 'manual', updatedAt: 0 } })).domain).toBe('example.org');
    const entries = {
      'example.org': { route: 'direct', source: 'manual', updatedAt: 0 },
      'events.example.org': { route: 'residential', source: 'manual', updatedAt: 0 }
    };
    expect(routePlan('https://www.example.org/', cfg(entries)).chain).toEqual(['direct']);
    expect(routePlan('https://events.example.org/', cfg(entries)).chain).toEqual(['residential']);
    expect(routePlan('https://notexample.org/', cfg(entries)).pinned).toBe(false);
  });
});

describe('currentRoute', () => {
  it('uses IPRoyal only while it is configured', () => {
    const c = cfg({ 'cvsr.org': { route: 'residential', source: 'manual', updatedAt: 0 } });
    delete process.env.RESIDENTIAL_PROXY;
    expect(currentRoute('https://cvsr.org/', c)).toBe('expressvpn');
    process.env.RESIDENTIAL_PROXY = 'http://u:p@geo.example.com:12321';
    expect(currentRoute('https://cvsr.org/', c)).toBe('residential');
  });
});

describe('isBlocked', () => {
  it('treats refused connections and block pages as blocks, not ordinary failures', () => {
    expect(isBlocked({ reachable: false, reason: 'page.goto: net::ERR_CONNECTION_CLOSED at https://x' })).toBe(true);
    expect(isBlocked({ reachable: false, reason: 'page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://x' })).toBe(true);
    expect(isBlocked({ reachable: false, reason: 'page.goto: net::ERR_TIMED_OUT at https://x' })).toBe(true);
    expect(isBlocked({ blocked: true })).toBe(true);
    expect(isBlocked({ reachable: false, reason: 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://x' })).toBe(false);
    expect(isBlocked({ reachable: false, reason: 'timeout' })).toBe(false);
    expect(isBlocked({ reachable: true, markdown: 'ok' })).toBe(false);
  });
});

describe('domains', () => {
  it('normalizes typed domains and files URLs without www', () => {
    expect(normalizeDomain(' https://www.NewFranklin.org/1222/x ')).toBe('newfranklin.org');
    expect(normalizeDomain('*.cvsr.org')).toBe('cvsr.org');
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(routePlan('https://www.cvsr.org/excursions', cfg()).domain).toBe('cvsr.org');
    expect(routePlan('nope', cfg())).toMatchObject({ domain: null, chain: ['expressvpn', 'direct', 'residential'] });
  });
});

describe('residentialProxy', () => {
  it('splits credentials out of RESIDENTIAL_PROXY', () => {
    process.env.RESIDENTIAL_PROXY = 'http://user:p%40ss_country-us@geo.example.com:12321';
    expect(residentialProxy()).toEqual({ server: 'http://geo.example.com:12321', bypass: '<-loopback>', username: 'user', password: 'p@ss_country-us' });
    delete process.env.RESIDENTIAL_PROXY;
    expect(residentialProxy()).toBeUndefined();
  });
});

describe('reserveResidential', () => {
  it('reserves a render atomically under the cap, and only when configured', async () => {
    setEgressConfig({ cap: 2 });
    const reserving = (granted) => ({ query: vi.fn(async () => ({ rows: granted ? [{ renders: 1 }] : [] })) });
    delete process.env.RESIDENTIAL_PROXY;
    const unconfigured = reserving(true);
    expect(await reserveResidential(unconfigured)).toBe(false);
    expect(unconfigured.query).not.toHaveBeenCalled();

    process.env.RESIDENTIAL_PROXY = 'http://u:p@geo.example.com:12321';
    const pool = reserving(true);
    expect(await reserveResidential(pool)).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(day, route\) DO UPDATE SET renders = egress_usage.renders \+ 1\s+WHERE egress_usage.renders < \$1/);
    expect(params).toEqual([2]);
    expect(await reserveResidential(reserving(false))).toBe(false); // at the cap: no row updated
  });

  it('denies IPRoyal when usage cannot be written, and when the cap is zero', async () => {
    process.env.RESIDENTIAL_PROXY = 'http://u:p@geo.example.com:12321';
    setEgressConfig({ cap: 100 });
    expect(await reserveResidential({ query: async () => { throw new Error('db down'); } })).toBe(false);
    setEgressConfig({ cap: 0 });
    const pool = { query: vi.fn(async () => ({ rows: [{ renders: 1 }] })) };
    expect(await reserveResidential(pool)).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('recordOutcome', () => {
  const pool = () => ({ query: vi.fn(async () => ({ rows: [] })) });
  const sqlOf = (p) => p.query.mock.calls.map(([sql]) => sql).join('\n');

  it('learns the fallback route that worked', async () => {
    setEgressConfig();
    const p = pool();
    const plan = routePlan('https://www.cvsr.org/x');
    await recordOutcome(p, plan, { route: 'direct', attempts: [{ route: 'expressvpn', reason: 'ERR_CONNECTION_CLOSED' }] });
    const [sql, params] = p.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO egress_domain_routes/);
    expect(sql).toMatch(/WHERE egress_domain_routes.source = 'auto'/);
    expect(params.slice(0, 2)).toEqual(['cvsr.org', 'direct']);
  });

  it('drops a learned route once the default works again', async () => {
    setEgressConfig({ entries: { 'cvsr.org': { route: 'residential', source: 'auto', updatedAt: Date.now() - 8 * DAY } } });
    const p = pool();
    await recordOutcome(p, routePlan('https://cvsr.org/'), { route: 'expressvpn', attempts: [] });
    expect(sqlOf(p)).toMatch(/DELETE FROM egress_domain_routes WHERE domain = \$1 AND source = 'auto'/);
  });

  it('never changes a pinned route, only notes when it last worked', async () => {
    setEgressConfig({ entries: { 'newfranklin.org': { route: 'direct', source: 'manual', updatedAt: 0 } } });
    const p = pool();
    await recordOutcome(p, routePlan('https://newfranklin.org/'), { route: 'direct', attempts: [] });
    expect(sqlOf(p)).toMatch(/UPDATE egress_domain_routes SET last_ok_at = NOW\(\)/);
    expect(sqlOf(p)).not.toMatch(/INSERT/);
  });

  it('flags a domain every route was blocked on', async () => {
    setEgressConfig();
    const p = pool();
    const attempts = [{ route: 'expressvpn', reason: 'ERR_CONNECTION_CLOSED' }, { route: 'direct', reason: 'ERR_TIMED_OUT' }];
    await recordOutcome(p, routePlan('https://blocked.org/'), { route: null, attempts });
    const [sql, params] = p.query.mock.calls[0];
    expect(sql).toMatch(/last_blocked_at = NOW\(\)/);
    expect(params).toEqual(['blocked.org', 'expressvpn', 'expressvpn: ERR_CONNECTION_CLOSED; direct: ERR_TIMED_OUT']);
  });

  it('writes nothing on a first-try success for an unlisted domain', async () => {
    setEgressConfig();
    const p = pool();
    await recordOutcome(p, routePlan('https://stanhywet.org/'), { route: 'expressvpn', attempts: [] });
    expect(p.query).not.toHaveBeenCalled();
  });
});

describe('loadEgressConfig', () => {
  it('reads the default, cap and entries, shares one query, and keeps the last good config on failure', async () => {
    resetEgressConfig();
    const pool = {
      query: vi.fn(async (sql) => sql.includes('admin_settings')
        ? { rows: [{ key: 'egress_default_route', value: 'direct' }, { key: 'egress_residential_daily_cap', value: '7' }] }
        : { rows: [{ domain: 'cvsr.org', route: 'residential', source: 'auto', updated_at: new Date().toISOString() }] })
    };
    const [cfgA] = await Promise.all([loadEgressConfig(pool), loadEgressConfig(pool)]);
    expect(pool.query).toHaveBeenCalledTimes(2); // one settings read + one routes read
    expect(cfgA.defaultRoute).toBe('direct');
    expect(cfgA.cap).toBe(7);
    expect(cfgA.entries['cvsr.org'].route).toBe('residential');

    vi.useFakeTimers({ now: Date.now() + 61_000 });
    const failing = { query: async () => { throw new Error('db down'); } };
    expect((await loadEgressConfig(failing)).defaultRoute).toBe('direct');
  });
});
