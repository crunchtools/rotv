/**
 * Unit tests for the water taxi duty poll (waterTaxiTrackerService, #701, #055).
 * The poll must put the last known position in the cache when a shuttle is on
 * duty, and must never throw or warn on the normal off-duty state — the socket
 * connect runs after it either way. The monitoring verdict must follow the
 * operator's on-duty list, not a timetable. socket.io-client is mocked, so
 * nothing here opens a socket or needs a database. Fetch is mocked via the global.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// A stand-in socket: records handlers so a test can deliver a feed event.
const fakeSocket = vi.hoisted(() => ({
  handlers: {},
  connected: true,
  on(event, fn) { this.handlers[event] = fn; },
  removeAllListeners() { this.handlers = {}; },
  close() {},
}));
vi.mock('socket.io-client', () => ({ default: vi.fn(() => fakeSocket) }));

import {
  pollDuty, getBoatPositions, getWaterTaxiStatus, stopTracker,
  startTracker, getWaterTaxiVerdict
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

describe('pollDuty — on-duty shuttle', () => {
  it('seeds a docked position from last_known_data and reports healthy', async () => {
    const fn = mockFetch({ body: routeBody([shuttle()]) });
    await pollDuty();

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
    expect(info.mock.calls.map(([l]) => l).join('\n')).toMatch(/On duty, seeded from API.*78W113620299/);
  });

  it('marks the boat active when the last event was a moving one', async () => {
    mockFetch({ body: routeBody([shuttle({ last_known_data: { ...LAST_KNOWN, event_reason: 'ON_PERIODIC' } })]) });
    await pollDuty();
    expect(getBoatPositions().harbor_hopper.status).toBe('active');
  });

  it('accepts numeric coordinates and the old last_* field names', async () => {
    mockFetch({ body: routeBody([shuttle({
      last_known_data: { last_latitude: 41.5, last_longitude: -81.7, last_heading: 90 },
    })]) });
    await pollDuty();
    expect(getBoatPositions().harbor_hopper).toMatchObject({ latitude: 41.5, longitude: -81.7, heading: 90 });
  });

  it('does not seed from another shuttle on a serial mismatch, and warns with the serials seen', async () => {
    mockFetch({ body: routeBody([
      shuttle({ serial_number: 'NEWSERIAL1', last_known_data: { ...LAST_KNOWN, latitude: '41.4' } }),
      shuttle({ serial_number: undefined, vin_no: 'VIN2' }),
    ]) });
    await pollDuty();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/78W113620299 not on duty/);
    expect(warnings()).toMatch(/NEWSERIAL1, VIN2/);
  });

  it('warns and leaves no position when the shuttle has no coordinates', async () => {
    mockFetch({ body: routeBody([shuttle({ last_known_data: { shuttle_data: {} } })]) });
    await pollDuty();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/no coordinates/);
  });
});

describe('pollDuty — nothing to seed', () => {
  it('treats an empty shuttle list as off duty: info, not warn, no position', async () => {
    mockFetch({ body: routeBody([]) });
    await expect(pollDuty()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(getWaterTaxiStatus()).toMatchObject({ hasPosition: false, healthy: false, updatedAt: null });
    expect(warn).not.toHaveBeenCalled();
    expect(info.mock.calls.map(([l]) => l).join('\n')).toMatch(/No shuttles on duty/);
  });

  it('warns on HTTP 401 without throwing', async () => {
    mockFetch({ status: 401 });
    await expect(pollDuty()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/HTTP 401/);
  });

  it('warns on a non-200 body code without throwing', async () => {
    mockFetch({ body: { code: 204, message: 'No Data Found', response: { route: [] } } });
    await expect(pollDuty()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/code 204/);
  });

  it('warns on a rejected fetch without throwing', async () => {
    mockFetch({ reject: new Error('fetch failed') });
    await expect(pollDuty()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/fetch failed/);
  });

  it('warns on a malformed body without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })));
    await expect(pollDuty()).resolves.toBeUndefined();
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(warnings()).toMatch(/bad json/);
  });
});

describe('getBoatPositions — staleness guard on a seeded position', () => {
  it('serves a docked seed for 24 h, then nulls it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    mockFetch({ body: routeBody([shuttle()]) });
    await pollDuty();
    expect(getBoatPositions().harbor_hopper).not.toBeNull();

    vi.setSystemTime(new Date('2026-10-11T11:59:00Z'));
    expect(getBoatPositions().harbor_hopper).not.toBeNull();

    vi.setSystemTime(new Date('2026-10-11T12:01:00Z'));
    expect(getBoatPositions()).toEqual({ harbor_hopper: null });
    expect(getWaterTaxiStatus().healthy).toBe(false);
    vi.useRealTimers();
  });
});

const POOL = { query: async () => ({ rows: [] }) };
const T0 = new Date('2026-07-10T21:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000).getTime();

async function startAt(fetchOpts) {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  mockFetch(fetchOpts);
  await startTracker(POOL);
}

describe('getWaterTaxiVerdict', () => {
  it('is ok while disabled', () => {
    expect(getWaterTaxiVerdict()).toEqual({ ok: true, state: 'disabled' });
  });

  it('is ok while disabled by the admin setting', async () => {
    mockFetch();
    await startTracker({ query: async () => ({ rows: [{ value: 'false' }] }) });
    expect(getWaterTaxiVerdict()).toEqual({ ok: true, state: 'disabled' });
  });

  it('is ok off duty, and stays ok across polls (night, off season)', async () => {
    await startAt({ body: routeBody([]) });
    expect(getWaterTaxiVerdict(at(1))).toEqual({ ok: true, state: 'off_duty' });
    await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(getWaterTaxiVerdict(Date.now())).toEqual({ ok: true, state: 'off_duty' });
  });

  it('is ok while starting, then alerts if the rider API never answers', async () => {
    await startAt({ status: 500 });
    expect(getWaterTaxiVerdict(at(5))).toMatchObject({ ok: true, state: 'starting' });
    expect(getWaterTaxiVerdict(at(11))).toMatchObject({ ok: false, state: 'unreachable' });
  });

  it('alerts when the rider API stops answering', async () => {
    await startAt({ body: routeBody([]) });
    mockFetch({ reject: new Error('fetch failed') });
    await vi.advanceTimersByTimeAsync(12 * 60000);
    expect(getWaterTaxiVerdict(Date.now())).toMatchObject({ ok: false, state: 'unreachable' });
  });

  it('alerts when another serial is on duty instead of ours', async () => {
    await startAt({ body: routeBody([shuttle({ serial_number: 'NEWSERIAL1' })]) });
    expect(getWaterTaxiVerdict(at(1))).toMatchObject({ ok: false, state: 'wrong_serial' });
    expect(getWaterTaxiVerdict(at(1)).reason).toMatch(/NEWSERIAL1/);
  });

  it('is ok on duty while socket events arrive', async () => {
    await startAt({ body: routeBody([shuttle()]) });
    await vi.advanceTimersByTimeAsync(10 * 60000);
    fakeSocket.handlers['78W113620299']({ code: 200, response: { latitude: '41.5', longitude: '-81.7', event_reason: 'ON_PERIODIC' } });
    await vi.advanceTimersByTimeAsync(10 * 60000);
    expect(getWaterTaxiVerdict(Date.now())).toEqual({ ok: true, state: 'in_service' });
  });

  it('alerts when on duty but the socket has gone silent', async () => {
    await startAt({ body: routeBody([shuttle()]) });
    expect(getWaterTaxiVerdict(at(9))).toEqual({ ok: true, state: 'in_service' });
    await vi.advanceTimersByTimeAsync(16 * 60000);
    expect(getWaterTaxiVerdict(Date.now())).toMatchObject({ ok: false, state: 'silent' });
  });

  it('gives a boat coming on duty a grace period, whatever the socket did before', async () => {
    await startAt({ body: routeBody([]) });
    await vi.advanceTimersByTimeAsync(5 * 60 * 60000);   // off duty all afternoon
    mockFetch({ body: routeBody([shuttle()]) });
    await vi.advanceTimersByTimeAsync(2 * 60000);        // next poll: on duty
    expect(getWaterTaxiVerdict(Date.now())).toEqual({ ok: true, state: 'in_service' });
  });

  it('logs an unchanged duty state once, not every poll', async () => {
    await startAt({ body: routeBody([]) });
    await vi.advanceTimersByTimeAsync(30 * 60000);
    const offDutyLogs = info.mock.calls.filter(([l]) => /No shuttles on duty/.test(l));
    expect(offDutyLogs).toHaveLength(1);
  });

  it('starts anyway when the admin setting cannot be read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    mockFetch({ body: routeBody([]) });
    await startTracker({ query: async () => { throw new Error('db down'); } });
    expect(getWaterTaxiVerdict(at(1))).toEqual({ ok: true, state: 'off_duty' });
    expect(warnings()).toMatch(/db down/);
  });
});

describe('pollDuty — does not clobber a live socket fix', () => {
  it('keeps a fresh socket position, and seeds again once the socket is quiet', async () => {
    await startAt({ body: routeBody([shuttle()]) });
    fakeSocket.handlers['78W113620299']({ code: 200, response: { latitude: '41.6', longitude: '-81.8', event_reason: 'ON_PERIODIC' } });
    await pollDuty();
    expect(getBoatPositions().harbor_hopper).toMatchObject({ latitude: 41.6, longitude: -81.8 });

    await vi.advanceTimersByTimeAsync(2 * 60000);
    expect(getBoatPositions().harbor_hopper).toMatchObject({ latitude: 41.49707, longitude: -81.70679 });
  });
});
