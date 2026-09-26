import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import usePoiContentList from './usePoiContentList';
import { fetchResponse } from '../test/fetchResponse';

const LIST_URL = '/api/pois/7/news?limit=50';
const STORY_A = { id: 11, title: 'Towpath reopens' };
const STORY_B = { id: 12, title: 'Bridge repair' };

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('alert', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
});

function wrapper({ children }) {
  return <MemoryRouter initialEntries={['/poi/7']}>{children}</MemoryRouter>;
}

function renderList(options) {
  return renderHook(
    () => ({ list: usePoiContentList({ kind: 'news', listUrl: LIST_URL, ...options }), location: useLocation() }),
    { wrapper }
  );
}

async function renderLoaded(options = {}) {
  fetchMock.mockResolvedValueOnce(fetchResponse([STORY_A, STORY_B]));
  const hook = renderList({ poiId: 7, ...options });
  await waitFor(() => expect(hook.result.current.list.loading).toBe(false));
  return hook;
}

describe('usePoiContentList load', () => {
  it('does not fetch without a poiId and does not stay stuck loading', async () => {
    const { result } = renderList({ poiId: null });

    await waitFor(() => expect(result.current.list.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.list.items).toEqual([]);

    await act(async () => { await result.current.list.handleCollect(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the list and reports the count', async () => {
    const onCountChange = vi.fn();
    const { result } = await renderLoaded({ onCountChange });

    expect(fetchMock).toHaveBeenCalledWith(LIST_URL);
    expect(result.current.list.items).toEqual([STORY_A, STORY_B]);
    expect(result.current.list.error).toBeNull();
    expect(onCountChange).toHaveBeenCalledWith(2);
  });

  it('drops a slow response for a POI the user has already left', async () => {
    let resolveFirst;
    fetchMock
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(fetchResponse([STORY_B]));
    const { result, rerender } = renderHook(
      ({ poiId }) => usePoiContentList({ poiId, kind: 'news', listUrl: `/api/pois/${poiId}/news` }),
      { wrapper, initialProps: { poiId: 7 } }
    );

    rerender({ poiId: 8 });
    await waitFor(() => expect(result.current.items).toEqual([STORY_B]));
    await act(async () => { resolveFirst(fetchResponse([STORY_A])); });

    expect(result.current.items).toEqual([STORY_B]);
    expect(result.current.loading).toBe(false);
  });

  it('reports a non-2xx load without calling onCountChange', async () => {
    const onCountChange = vi.fn();
    fetchMock.mockResolvedValueOnce(fetchResponse({}, { status: 503, statusText: 'Service Unavailable' }));
    const { result } = renderList({ poiId: 7, onCountChange });

    await waitFor(() => expect(result.current.list.loading).toBe(false));

    expect(result.current.list.error).toBe('Failed to load news');
    expect(result.current.list.items).toEqual([]);
    expect(onCountChange).not.toHaveBeenCalled();
  });
});

describe('usePoiContentList delete', () => {
  it('removes the item after a successful delete', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ success: true }));

    await act(async () => { await result.current.list.handleDelete(11); });

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/news/11', { method: 'DELETE', credentials: 'include' });
    expect(result.current.list.items).toEqual([STORY_B]);
    expect(result.current.list.deleting).toBeNull();
  });

  it('keeps the item and sets an error when delete fails', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({}, { status: 500 }));

    await act(async () => { await result.current.list.handleDelete(11); });

    expect(result.current.list.items).toEqual([STORY_A, STORY_B]);
    expect(result.current.list.error).toBe('Failed to delete: HTTP 500');
    expect(result.current.list.deleting).toBeNull();
  });
});

describe('usePoiContentList collect', () => {
  it('posts the stored timezone and navigates to the job', async () => {
    localStorage.setItem('app-timezone', 'America/Chicago');
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ jobId: 'j-1', jobType: 'news', poiId: 7 }));

    await act(async () => { await result.current.list.handleCollect(); });

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/pois/7/news/collect', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ timezone: 'America/Chicago' })
    }));
    expect(result.current.location.pathname).toBe('/admin/jobs');
    expect(result.current.location.search).toBe('?job=j-1&type=news&poi=7');
    expect(alert).not.toHaveBeenCalled();
  });

  it('alerts the server message and re-enables the button on a non-2xx collect', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ error: 'Already running' }, { status: 409 }));

    await act(async () => { await result.current.list.handleCollect(); });

    expect(alert).toHaveBeenCalledWith('Collection failed: Already running');
    expect(result.current.list.collecting).toBe(false);
    expect(result.current.location.pathname).toBe('/poi/7');
  });

  it('alerts and re-enables the button on a network error', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await act(async () => { await result.current.list.handleCollect(); });

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/pois/7/news/collect', expect.objectContaining({
      body: JSON.stringify({ timezone: 'America/New_York' })
    }));
    expect(alert).toHaveBeenCalledWith('Collection failed: offline');
    expect(result.current.list.collecting).toBe(false);
  });
});
