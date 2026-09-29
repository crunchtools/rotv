import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PUBLIC_STATS_PATHS, analyticsWebsiteId, statsProxy, UMAMI_WEBSITE_ID, getStatsSummary, getStatsTop } from '../services/analyticsService.js';
import { track, trackerVehicle } from '../../frontend/src/utils/analytics.js';

describe('stats proxy access (#637)', () => {
  // The suite may run with the test auth bypass live; these check the real gate
  beforeEach(() => { vi.stubEnv('BYPASS_AUTH', 'false'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('exposes only the tracker script and the collector publicly', () => {
    expect(PUBLIC_STATS_PATHS.has('/stats/script.js')).toBe(true);
    expect(PUBLIC_STATS_PATHS.has('/stats/api/send')).toBe(true);
    expect(PUBLIC_STATS_PATHS.has('/stats/api/websites')).toBe(false);
    expect(PUBLIC_STATS_PATHS.has('/stats/share/rotv')).toBe(false);
    expect(PUBLIC_STATS_PATHS.has('/stats/login')).toBe(false);
    expect(PUBLIC_STATS_PATHS.has('/stats/api/send/../websites')).toBe(false);
  });

  it('refuses the dashboard to anonymous visitors', () => {
    const req = { originalUrl: '/stats/api/websites?x=1', isAuthenticated: () => false };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    statsProxy(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('refuses the dashboard to signed-in non-admins', () => {
    const req = { originalUrl: '/stats/share/rotv', isAuthenticated: () => true, user: { is_admin: false } };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    statsProxy(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('analyticsWebsiteId', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('is off under test unless explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('UMAMI_ENABLED', '');
    expect(await analyticsWebsiteId()).toBe(null);
  });

  it('is off when explicitly disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UMAMI_ENABLED', 'false');
    expect(await analyticsWebsiteId()).toBe(null);
  });

  it('follows the Umami heartbeat when enabled', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('UMAMI_ENABLED', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    expect(await analyticsWebsiteId()).toBe(UMAMI_WEBSITE_ID);
  });
});

describe('Umami API client for the MCP tools', () => {
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

  beforeEach(() => { vi.stubEnv('UMAMI_ADMIN_PASSWORD', 'pw'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  function umami(routes) {
    const fetchMock = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/api/auth/login')) return json({ token: 't1' });
      const hit = Object.entries(routes).find(([suffix]) => path.endsWith(suffix));
      return hit ? hit[1](url) : json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('summarises totals, a daily series and tracker use', async () => {
    umami({
      '/stats': () => json({ visitors: 5, visits: 6, pageviews: 9, bounces: 2 }),
      '/pageviews': () => json({
        sessions: [{ x: '2026-09-28', y: 4 }, { x: '2026-09-29', y: 2 }],
        pageviews: [{ x: '2026-09-29', y: 3 }],
      }),
      '/event-data/values': (url) => json(new URL(url).searchParams.get('eventName') === 'tracker_click'
        ? [{ value: 'train', total: 3 }] : [{ value: 'water_taxi', total: 1 }]),
    });
    const summary = await getStatsSummary(7);
    expect(summary).toMatchObject({ days: 7, visitors: 5, visits: 6, pageviews: 9, bounces: 2 });
    expect(summary.daily).toEqual([
      { date: '2026-09-28', visits: 4, pageviews: 0 },
      { date: '2026-09-29', visits: 2, pageviews: 3 },
    ]);
    expect(summary.trackers.clicks).toEqual([{ value: 'train', total: 3 }]);
    expect(summary.trackers.route_opens).toEqual([{ value: 'water_taxi', total: 1 }]);
  });

  it('returns event property values, capped at the limit', async () => {
    umami({ '/event-data/values': () => json([{ value: 'a', total: 3 }, { value: 'b', total: 2 }, { value: 'c', total: 1 }]) });
    expect(await getStatsTop({ metric: 'property', days: 7, limit: 2, event: 'search', property: 'query' }))
      .toEqual([{ value: 'a', total: 3 }, { value: 'b', total: 2 }]);
  });

  it('requires event and property for metric=property', async () => {
    await expect(getStatsTop({ metric: 'property', days: 7, limit: 5, event: 'search' }))
      .rejects.toThrow('needs both event and property');
  });

  it('passes other metrics through to /metrics', async () => {
    const fetchMock = umami({ '/metrics': () => json([{ x: 'google.com', y: 4 }]) });
    expect(await getStatsTop({ metric: 'referrer', days: 7, limit: 5 })).toEqual([{ x: 'google.com', y: 4 }]);
    const metricsUrl = new URL(fetchMock.mock.calls.at(-1)[0]);
    expect(metricsUrl.searchParams.get('type')).toBe('referrer');
    expect(metricsUrl.searchParams.get('limit')).toBe('5');
  });

  it('logs in again once when the cached token is rejected', async () => {
    let calls = 0;
    const fetchMock = umami({ '/metrics': () => (++calls === 1 ? json({}, 401) : json([{ x: 'US', y: 1 }])) });
    expect(await getStatsTop({ metric: 'country', days: 1, limit: 5 })).toEqual([{ x: 'US', y: 1 }]);
    const logins = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/login'));
    expect(logins.length).toBeGreaterThanOrEqual(1);
  });

  it('fails clearly without UMAMI_ADMIN_PASSWORD', async () => {
    umami({ '/metrics': () => json({}, 401) });
    vi.stubEnv('UMAMI_ADMIN_PASSWORD', '');
    await expect(getStatsTop({ metric: 'os', days: 1, limit: 5 })).rejects.toThrow('UMAMI_ADMIN_PASSWORD is not set');
  });
});

describe('website id', () => {
  it('matches the id umami-setup creates', () => {
    const setup = fs.readFileSync(path.resolve(import.meta.dirname, '../../rootfs/usr/local/bin/umami-setup.mjs'), 'utf-8');
    expect(setup).toContain(`const WEBSITE_ID = '${UMAMI_WEBSITE_ID}';`);
  });
});

describe('frontend initAnalytics()', () => {
  let appended;

  beforeEach(() => {
    vi.resetModules();
    appended = [];
    globalThis.window = {};
    globalThis.document = {
      createElement: () => ({ dataset: {} }),
      head: { appendChild: (el) => appended.push(el) },
    };
  });
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    vi.unstubAllGlobals();
  });

  const load = () => import('../../frontend/src/utils/analytics.js');

  it('loads nothing when analytics is off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ websiteId: null }) })));
    const { initAnalytics } = await load();
    await initAnalytics();
    expect(appended).toEqual([]);
  });

  it('loads nothing when the config request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { initAnalytics } = await load();
    await initAnalytics();
    expect(appended).toEqual([]);
  });

  it('injects the tracker once and flushes events queued before it loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ websiteId: 'site-1' }) })));
    const { initAnalytics, track } = await load();
    track('poi_view', { poi_id: 7 });
    await initAnalytics();
    await initAnalytics();
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe('/stats/script.js');
    expect(appended[0].dataset.websiteId).toBe('site-1');
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    appended[0].onload();
    expect(umamiTrack).toHaveBeenCalledWith('poi_view', { poi_id: 7 });
  });

  it('drops queued events if the tracker is blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ websiteId: 'site-1' }) })));
    const { initAnalytics, track } = await load();
    track('search', { query: 'x' });
    await initAnalytics();
    appended[0].onerror();
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    appended[0].onload();
    expect(umamiTrack).not.toHaveBeenCalled();
  });
});

describe('frontend track()', () => {
  beforeEach(() => { globalThis.window = {}; });
  afterEach(() => { delete globalThis.window; });

  it('is a silent no-op when the tracker is not loaded', () => {
    expect(() => track('poi_view', { poi_id: 1 })).not.toThrow();
  });

  it('forwards to umami when loaded, and swallows its errors', () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    track('tracker_click', { vehicle: 'train', status: 'Live' });
    expect(umamiTrack).toHaveBeenCalledWith('tracker_click', { vehicle: 'train', status: 'Live' });
    window.umami = { track: () => { throw new Error('blocked'); } };
    expect(() => track('search', { query: 'x' })).not.toThrow();
  });

  it('identifies tracker routes by role', () => {
    expect(trackerVehicle({ poi_roles: ['railroad'] })).toBe('train');
    expect(trackerVehicle({ poi_roles: ['water_taxi'] })).toBe('water_taxi');
    expect(trackerVehicle({ poi_roles: ['trail'] })).toBe(null);
    expect(trackerVehicle(null)).toBe(null);
  });
});
