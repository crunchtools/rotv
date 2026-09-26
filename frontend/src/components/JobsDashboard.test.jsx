import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JobsDashboard from './JobsDashboard';
import { fetchResponse } from '../test/fetchResponse';

const SCHEDULED_URL = '/api/admin/jobs/scheduled';
const TRAIL_STATUS_URL = '/api/admin/trail-status/job-status/latest';
const TRAIL_JOB = { id: 'trail_status', historyTypes: ['trail_status'] };

let fetchMock;

const callsTo = (fragment) => fetchMock.mock.calls.filter(([url]) => url.includes(fragment)).length;

// Let pending fetch promises and the state updates they trigger settle
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn((url) => Promise.resolve(fetchResponse(url.includes(SCHEDULED_URL) ? [] : { status: 'completed' })));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

function renderDashboard() {
  return render(<MemoryRouter><JobsDashboard /></MemoryRouter>);
}

describe('JobsDashboard polling (#638)', () => {
  it('loads once on mount instead of re-fetching in a loop', async () => {
    renderDashboard();
    for (let i = 0; i < 10; i++) await flush();

    expect(callsTo(SCHEDULED_URL)).toBe(1);
    expect(callsTo('/api/admin/news/status')).toBe(3);
    expect(callsTo('/api/admin/trail-status/job-status/latest')).toBe(1);
  });

  it('polls scheduled jobs every 15s while idle', async () => {
    renderDashboard();
    await flush();

    await act(async () => { await vi.advanceTimersByTimeAsync(45000); });

    expect(callsTo(SCHEDULED_URL)).toBe(4);
  });

  it('skips polling while the tab is hidden', async () => {
    renderDashboard();
    await flush();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });

    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });

    expect(callsTo(SCHEDULED_URL)).toBe(1);
  });

  // Fix: cover the 2s running cadence and completion handling that reads scheduledJobs via the ref (PR #639 review)
  it('polls every 2s while a job runs, then loads its history when it completes', async () => {
    let trailStatus = { status: 'running', id: 'run-1' };
    fetchMock.mockImplementation((url) => {
      if (url.includes(SCHEDULED_URL)) return Promise.resolve(fetchResponse([TRAIL_JOB]));
      if (url.includes(TRAIL_STATUS_URL)) return Promise.resolve(fetchResponse(trailStatus));
      if (url.includes('/api/admin/jobs/history')) return Promise.resolve(fetchResponse([]));
      return Promise.resolve(fetchResponse({ status: 'completed' }));
    });

    renderDashboard();
    for (let i = 0; i < 5; i++) await flush();
    expect(callsTo(TRAIL_STATUS_URL)).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(callsTo(TRAIL_STATUS_URL)).toBe(4);
    expect(callsTo('/api/admin/jobs/history')).toBe(0);

    trailStatus = { status: 'completed', id: 'run-1' };
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    for (let i = 0; i < 5; i++) await flush();

    expect(callsTo('type=trail_status')).toBe(1);
    const statusCallsAtIdle = callsTo(TRAIL_STATUS_URL);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(callsTo(TRAIL_STATUS_URL)).toBe(statusCallsAtIdle);
  });
});
