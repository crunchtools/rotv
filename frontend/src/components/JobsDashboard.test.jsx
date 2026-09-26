import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JobsDashboard from './JobsDashboard';
import { fetchResponse } from '../test/fetchResponse';

const SCHEDULED_URL = '/api/admin/jobs/scheduled';

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
});
