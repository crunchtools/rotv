/**
 * Per-domain scraper egress (egress_routes): which sites go direct, through
 * ExpressVPN (the default) or through a residential proxy.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  parseEgressRoutes, routeFor, directBypassList, residentialProxy, effectiveRoute,
  loadEgressRoutes, setEgressRoutes, resetEgressRoutes
} from '../services/egressRoutes.js';

const savedResidential = process.env.RESIDENTIAL_PROXY;

afterEach(() => {
  if (savedResidential === undefined) delete process.env.RESIDENTIAL_PROXY;
  else process.env.RESIDENTIAL_PROXY = savedResidential;
  setEgressRoutes({});
});

describe('parseEgressRoutes', () => {
  it('normalizes domains and drops unknown routes', () => {
    expect(parseEgressRoutes('{" NewFranklin.org ": "direct", "*.cvsr.org": "residential", "x.com": "tor"}'))
      .toEqual({ 'newfranklin.org': 'direct', 'cvsr.org': 'residential' });
  });

  it('returns no routes for unset, invalid or non-object values', () => {
    expect(parseEgressRoutes(null)).toEqual({});
    expect(parseEgressRoutes('{not json')).toEqual({});
    expect(parseEgressRoutes('["newfranklin.org"]')).toEqual({});
  });
});

describe('routeFor', () => {
  const table = { 'newfranklin.org': 'direct', 'example.org': 'residential', 'www.example.org': 'expressvpn' };

  it('matches the domain and its subdomains', () => {
    expect(routeFor('https://newfranklin.org/1222/Community-Events', table)).toBe('direct');
    expect(routeFor('https://www.newfranklin.org/', table)).toBe('direct');
  });

  it('does not match a look-alike domain', () => {
    expect(routeFor('https://notnewfranklin.org/', table)).toBe('expressvpn');
  });

  it('prefers the most specific entry', () => {
    expect(routeFor('https://www.example.org/', table)).toBe('expressvpn');
    expect(routeFor('https://events.example.org/', table)).toBe('residential');
  });

  it('defaults unlisted hosts and unparseable URLs to expressvpn', () => {
    expect(routeFor('https://stanhywet.org/public-events', table)).toBe('expressvpn');
    expect(routeFor('not a url', table)).toBe('expressvpn');
  });
});

describe('directBypassList', () => {
  it('lists each direct domain and its subdomains for Chromium', () => {
    expect(directBypassList({ 'newfranklin.org': 'direct', 'cvsr.org': 'residential', 'a.gov': 'direct' }))
      .toBe('newfranklin.org,.newfranklin.org,a.gov,.a.gov');
    expect(directBypassList({})).toBe('');
  });
});

describe('residentialProxy', () => {
  it('splits credentials out of RESIDENTIAL_PROXY', () => {
    process.env.RESIDENTIAL_PROXY = 'http://user:p%40ss@geo.example.com:12321';
    expect(residentialProxy()).toEqual({ server: 'http://geo.example.com:12321', username: 'user', password: 'p@ss' });
  });

  it('is undefined while RESIDENTIAL_PROXY is unset', () => {
    delete process.env.RESIDENTIAL_PROXY;
    expect(residentialProxy()).toBeUndefined();
  });
});

describe('effectiveRoute', () => {
  it('falls back from residential to expressvpn while RESIDENTIAL_PROXY is unset', () => {
    delete process.env.RESIDENTIAL_PROXY;
    expect(effectiveRoute('residential')).toBe('expressvpn');
    process.env.RESIDENTIAL_PROXY = 'http://geo.example.com:12321';
    expect(effectiveRoute('residential')).toBe('residential');
    expect(effectiveRoute('direct')).toBe('direct');
  });
});

describe('loadEgressRoutes', () => {
  it('reads the setting, caches it, and keeps the last good routes when a read fails', async () => {
    resetEgressRoutes();
    const pool = { query: vi.fn(async () => ({ rows: [{ value: '{"newfranklin.org": "direct"}' }] })) };
    expect(await loadEgressRoutes(pool)).toEqual({ 'newfranklin.org': 'direct' });
    expect(routeFor('https://newfranklin.org/')).toBe('direct');
    await loadEgressRoutes(pool);
    expect(pool.query).toHaveBeenCalledTimes(1);

    resetEgressRoutes();
    const slow = { query: vi.fn(async () => ({ rows: [{ value: '{"a.org": "direct"}' }] })) };
    await Promise.all([loadEgressRoutes(slow), loadEgressRoutes(slow), loadEgressRoutes(slow)]);
    expect(slow.query).toHaveBeenCalledTimes(1);

    resetEgressRoutes();
    setEgressRoutes({ 'newfranklin.org': 'direct' });
    vi.useFakeTimers({ now: Date.now() + 61_000 });
    try {
      const failing = { query: async () => { throw new Error('db down'); } };
      expect(await loadEgressRoutes(failing)).toEqual({ 'newfranklin.org': 'direct' });
    } finally {
      vi.useRealTimers();
    }
  });
});
