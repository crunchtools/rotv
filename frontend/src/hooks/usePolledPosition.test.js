import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import usePolledPosition from './usePolledPosition';
import { fetchResponse } from '../test/fetchResponse';

const URL = '/api/boat/positions';
const INTERVAL_MS = 10000;

let fetchMock;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

// Let the pending fetch().then().then() chain settle under fake timers.
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('usePolledPosition', () => {
  it('returns the tracker entry from the first poll', async () => {
    fetchMock.mockResolvedValue(fetchResponse({ boat1: { lat: 41.2 }, boat2: { lat: 40.0 } }));
    const { result } = renderHook(() => usePolledPosition(URL, 'boat1', INTERVAL_MS));

    expect(result.current).toBeNull();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(URL);
    expect(result.current).toEqual({ lat: 41.2 });
  });

  it('polls again on each interval and takes the new position', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ boat1: { lat: 1 } }))
      .mockResolvedValueOnce(fetchResponse({ boat1: { lat: 2 } }));
    const { result } = renderHook(() => usePolledPosition(URL, 'boat1', INTERVAL_MS));
    await flush();
    expect(result.current).toEqual({ lat: 1 });

    await tick(INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ lat: 2 });
  });

  it('returns null when the tracker key is missing from the reply', async () => {
    fetchMock.mockResolvedValue(fetchResponse({ boat2: { lat: 40.0 } }));
    const { result } = renderHook(() => usePolledPosition(URL, 'boat1', INTERVAL_MS));
    await flush();

    expect(result.current).toBeNull();
  });

  it('drops back to null when a later poll fails', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ boat1: { lat: 1 } }))
      .mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => usePolledPosition(URL, 'boat1', INTERVAL_MS));
    await flush();
    expect(result.current).toEqual({ lat: 1 });

    await tick(INTERVAL_MS);

    expect(result.current).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('stops polling on unmount', async () => {
    fetchMock.mockResolvedValue(fetchResponse({ boat1: { lat: 1 } }));
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => usePolledPosition(URL, 'boat1', INTERVAL_MS));
    await flush();

    unmount();
    await tick(INTERVAL_MS * 3);

    expect(clearSpy).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
