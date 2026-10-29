/**
 * Unit tests for the resilient CVSR train tracker (trainTrackerService).
 * Covers the 2026-07-10 outage class: a startup/network failure must NOT kill
 * the tracker — the poll loop authenticates lazily and self-heals. Also covers
 * 401 re-auth, the staleness guard on getTrainPositions(), and the monitoring
 * verdict (#055), which must follow the train's own state, not a timetable.
 * trainTrackerService uses the global fetch, so we mock it directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  pollOnce, getTrainPositions, getTrainStatus, stopTrainTracker,
  startTrainTracker, getTrainVerdict
} from '../services/trainTrackerService.js';

const DEVICE = {
  name: 'National Park Scenic',
  ignition: true,
  location: { latitude: 41.35, longitude: -81.6, heading: 76, velocity: 0, lastUpdated: '2026-07-10T20:26:57Z' },
};

// Route fetch by URL: auth vs devices. Each knob controls one failure mode.
function mockFetch({ authOk = true, deviceStatus = 200, devices = [DEVICE], throwOn = null } = {}) {
  const fn = vi.fn(async (url) => {
    if (throwOn && url.includes(throwOn)) throw new Error('fetch failed');
    if (url.includes('/auth/login/shared-view')) {
      return { ok: authOk, status: authOk ? 200 : 401, statusText: 'Unauthorized', json: async () => ({ token: 'jwt-abc' }) };
    }
    if (url.includes('/map/devices')) {
      const ok = deviceStatus >= 200 && deviceStatus < 300;
      return { ok, status: deviceStatus, statusText: 'x', json: async () => devices };
    }
    throw new Error(`unexpected url ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => { stopTrainTracker(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('pollOnce — happy path', () => {
  it('populates position and reports healthy', async () => {
    mockFetch();
    await pollOnce();
    expect(getTrainPositions().cvsr).toMatchObject({
      latitude: 41.35, longitude: -81.6, heading: 76, speed: 0, status: 'idle',
    });
    const status = getTrainStatus();
    expect(status.hasPosition).toBe(true);
    expect(status.healthy).toBe(true);
    expect(status.lastError).toBeNull();
  });

  it('marks a train with ignition off as parked', async () => {
    mockFetch({ devices: [{ ...DEVICE, ignition: false }] });
    await pollOnce();
    expect(getTrainPositions().cvsr.status).toBe('parked');
  });
});

describe('pollOnce — resilience (the outage class)', () => {
  it('does not throw when startup auth fails, and leaves no position', async () => {
    mockFetch({ authOk: false });
    await expect(pollOnce()).resolves.toBeUndefined();
    expect(getTrainPositions().cvsr).toBeNull();
    expect(getTrainStatus().lastError).toMatch(/auth failed/i);
  });

  it('does not throw on a network error and self-heals on the next cycle', async () => {
    mockFetch({ throwOn: '/auth/login' });        // egress down at startup
    await pollOnce();
    expect(getTrainPositions().cvsr).toBeNull();   // dead this cycle...

    mockFetch();                                   // egress recovers
    await pollOnce();
    expect(getTrainPositions().cvsr).not.toBeNull(); // ...alive the next
  });

  it('re-authenticates on a 401 without throwing', async () => {
    const fn = mockFetch({ deviceStatus: 401 });
    await pollOnce();
    const authCalls = fn.mock.calls.filter(([u]) => u.includes('/auth/login')).length;
    expect(authCalls).toBe(2);                     // initial + re-auth after 401
    expect(getTrainPositions().cvsr).toBeNull();   // no position this cycle

    mockFetch();                                   // token now accepted
    await pollOnce();
    expect(getTrainPositions().cvsr).not.toBeNull();
  });
});

describe('getTrainPositions — staleness guard', () => {
  it('serves null once the last successful poll is stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T20:00:00Z'));
    mockFetch();
    await pollOnce();
    expect(getTrainPositions().cvsr).not.toBeNull();       // fresh

    vi.setSystemTime(new Date('2026-07-10T20:10:00Z'));    // +10 min > 5 min STALE_MS
    expect(getTrainPositions().cvsr).toBeNull();
    expect(getTrainStatus().healthy).toBe(false);
  });
});

describe('pollOnce — no devices', () => {
  it('counts an empty device list as a good poll with no train', async () => {
    mockFetch({ devices: [] });
    await pollOnce();
    expect(getTrainPositions().cvsr).toBeNull();
    expect(getTrainStatus().lastError).toBeNull();
    expect(getTrainStatus().lastPollOkAt).not.toBeNull();
  });
});

// The admin_settings lookups all answer with a token, so the tracker starts.
const POOL = { query: async () => ({ rows: [{ value: 'share-token' }] }) };
const T0 = new Date('2026-10-30T14:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000);

async function startAt(fetchOpts) {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  mockFetch(fetchOpts);
  await startTrainTracker(POOL);
  await pollOnce();
}

describe('getTrainVerdict', () => {
  it('is ok while disabled', () => {
    expect(getTrainVerdict()).toEqual({ ok: true, state: 'disabled' });
  });

  it('is ok while starting, then alerts if USFT never answers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    mockFetch({ authOk: false });
    await startTrainTracker(POOL);
    expect(getTrainVerdict(at(1).getTime())).toMatchObject({ ok: true, state: 'starting' });
    expect(getTrainVerdict(at(6).getTime())).toMatchObject({ ok: false, state: 'unreachable' });
  });

  it('alerts when polls stop succeeding', async () => {
    await startAt({ devices: [{ ...DEVICE, ignition: false }] });
    expect(getTrainVerdict(at(1).getTime()).ok).toBe(true);
    const v = getTrainVerdict(at(6).getTime());
    expect(v).toMatchObject({ ok: false, state: 'unreachable' });
  });

  it('is ok when parked, however old the fix (night, off season)', async () => {
    const old = { ...DEVICE.location, lastUpdated: '2026-09-01T00:00:00Z' };
    await startAt({ devices: [{ ...DEVICE, ignition: false, location: old }] });
    expect(getTrainVerdict(at(1).getTime())).toEqual({ ok: true, state: 'parked' });
  });

  it('is ok when USFT lists no train', async () => {
    await startAt({ devices: [] });
    expect(getTrainVerdict(at(1).getTime())).toEqual({ ok: true, state: 'no_vehicle' });
  });

  it('is ok in service with a fresh fix', async () => {
    const fresh = { ...DEVICE.location, velocity: 12, lastUpdated: at(-4).toISOString() };
    await startAt({ devices: [{ ...DEVICE, location: fresh }] });
    expect(getTrainVerdict(at(1).getTime())).toEqual({ ok: true, state: 'in_service' });
  });

  it('is ok idling at a station with ignition on and an old fix', async () => {
    const stale = { ...DEVICE.location, velocity: 0, lastUpdated: at(-40).toISOString() };
    await startAt({ devices: [{ ...DEVICE, location: stale }] });
    expect(getTrainVerdict(at(1).getTime())).toEqual({ ok: true, state: 'in_service' });
  });
});
