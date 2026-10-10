/**
 * Unit tests for the water taxi startup seed (waterTaxiTrackerService, #701).
 * The seed must put the last known position in the cache when a shuttle is on
 * duty, and must never throw or warn on the normal off-duty state — the socket
 * connect runs after it either way. Only seedFromApi() is exercised; nothing
 * here opens a socket or needs a database. Fetch is mocked via the global.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  seedFromApi, getBoatPositions, getWaterTaxiStatus, stopTracker
} from '../services/waterTaxiTrackerService.js';

const SERIAL = '78W113620299';

const LAST_KNOWN = {
  latitude: '41.49707', longitude: '-81.70679', heading_degrees: '270',
  event_reason: 'IGN_OFF', text: 'Harbor Hopper', shuttle_data: { i_h: 0 },
};

function shuttle(overrides = {}) {
  return { serial_number: SERIAL, shuttle_id: 1, shuttle_name: 'Harbor Hopper', last_known_data: LAST_KNOWN, ...overrides };
}

function routeBody(shuttles, code = 200) {
  return { code, message: code === 200 ? 'Success' : 'No Data Found', response: { route: { shuttle_count: shuttles.length }, stop_list: [], shuttle_details: shuttles, org_id: 5799 } };
}

function mockFetch({ status = 200, body = routeBody([]), reject = null } = {}) {
  const fn = vi.fn(async () => {
    if (reject) throw reject;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

// The logger filters on LOG_LEVEL at call time; pin it so the info assertions
// hold whatever the container's env says.
let warn, info;
beforeEach(() => {
  stopTracker();
  vi.stubEnv('LOG_LEVEL', 'info');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

const warnings = () => warn.mock.calls.map(([line]) => line).join('\n');

describe('seedFromApi — on-duty shuttle', () => {
  it('seeds a docked position from last_known_data and reports healthy', async () => {
    const fn = mockFetch({ body: routeBody([shuttle()]) });
    await seedFromApi();

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, opts] = fn.mock.calls[0];
    expect(url).toContain('/route-code-details?route_code=5799&type=2');
    expect(opts.headers['token-id']).toBe('5799');

    expect(getBoatPositions().harbor_hopper).toMatchObject({
      latitude: 41.49707, longitude: -81.70679, heading: 270, status: 'docked',
    });
    const status = getWaterTaxiStatus();
    expect(status.hasPosition).toBe(true);
    expect(status.healthy).toBe(true);
    expect(status.connected).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(info.mock.calls.map(([l]) => l).join('\n')).toMatch(/Seeded from API.*78W113620299/);
  });

  it('marks the boat active when the last event was a moving one', async () => {
    mockFetch({ body: routeBody([shuttle({ last_known_data: { ...LAST_KNOWN, event_reason: 'ON_PERIODIC' } })]) });
    await seedFromApi();
    expect(getBoatPositions().harbor_hopper.status).toBe('active');
  });

  it('accepts numeric coordinates and the old last_* field names', async () => {
    mockFetch({ body: routeBody([shuttle({
      last_known_data: { last_latitude: 41.5, last_longitude: -81.7, last_heading: 90 },
    })]) });
    await seedFromApi();
    expect(getBoatPositions().harbor_hopper).toMatchObject({ latitude: 41.5, longitude: -81.7, heading: 90 });
  });

  it('does not seed from another shuttle on a serial mismatch, and warns with the serials seen', async () => {
    mockFetch({ body: routeBody([
      shuttle({ serial_number: 'NEWSERIAL1', last_known_data: { ...LAST_KNOWN, latitude: '41.4' } }),
      shuttle({ serial_number: undefined, vin_no: 'VIN2' }),
    ]) });
    await seedFromApi();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/78W113620299 not on duty/);
    expect(warnings()).toMatch(/NEWSERIAL1, VIN2/);
  });

  it('warns and leaves no position when the shuttle has no coordinates', async () => {
    mockFetch({ body: routeBody([shuttle({ last_known_data: { shuttle_data: {} } })]) });
    await seedFromApi();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/no coordinates/);
  });
});

describe('seedFromApi — nothing to seed', () => {
  it('treats an empty shuttle list as off duty: info, not warn, no position', async () => {
    mockFetch({ body: routeBody([]) });
    await expect(seedFromApi()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(getWaterTaxiStatus()).toMatchObject({ hasPosition: false, healthy: false, updatedAt: null });
    expect(warn).not.toHaveBeenCalled();
    expect(info.mock.calls.map(([l]) => l).join('\n')).toMatch(/No shuttles on duty/);
  });

  it('warns on HTTP 401 without throwing', async () => {
    mockFetch({ status: 401 });
    await expect(seedFromApi()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/HTTP 401/);
  });

  it('warns on a non-200 body code without throwing', async () => {
    mockFetch({ body: { code: 204, message: 'No Data Found', response: { route: [] } } });
    await expect(seedFromApi()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/code 204/);
  });

  it('warns on a rejected fetch without throwing', async () => {
    mockFetch({ reject: new Error('fetch failed') });
    await expect(seedFromApi()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/fetch failed/);
  });

  it('warns on a malformed body without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })));
    await expect(seedFromApi()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/bad json/);
  });
});

describe('getBoatPositions — staleness guard on a seeded position', () => {
  it('serves a docked seed for 24 h, then nulls it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    mockFetch({ body: routeBody([shuttle()]) });
    await seedFromApi();
    expect(getBoatPositions().harbor_hopper).not.toBeNull();

    vi.setSystemTime(new Date('2026-10-11T11:59:00Z'));
    expect(getBoatPositions().harbor_hopper).not.toBeNull();

    vi.setSystemTime(new Date('2026-10-11T12:01:00Z'));
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(getWaterTaxiStatus().healthy).toBe(false);
    vi.useRealTimers();
  });
});
