import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useOrderedAdminList from './useOrderedAdminList';
import { fetchResponse } from '../test/fetchResponse';

const ENDPOINT = '/api/admin/activities';
const HIKING = { id: 1, name: 'Hiking' };
const BIKING = { id: 2, name: 'Biking' };
const PADDLING = { id: 3, name: 'Paddling' };

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

async function renderLoaded(initial = [HIKING, BIKING]) {
  fetchMock.mockResolvedValueOnce(fetchResponse(initial));
  const hook = renderHook(() => useOrderedAdminList(ENDPOINT, 'activity', 'activities'));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useOrderedAdminList load', () => {
  it('loads the list from the endpoint with credentials', async () => {
    const { result } = await renderLoaded();
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, { credentials: 'include' });
    expect(result.current.items).toEqual([HIKING, BIKING]);
    expect(result.current.error).toBeNull();
  });

  it('reports a non-2xx load with the plural noun', async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({}, { status: 500 }));
    const { result } = renderHook(() => useOrderedAdminList(ENDPOINT, 'activity', 'activities'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to fetch activities');
    expect(result.current.items).toEqual([]);
  });

  it('reports a network failure on load', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useOrderedAdminList(ENDPOINT, 'activity', 'activities'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to fetch activities: offline');
  });
});

describe('useOrderedAdminList create/update', () => {
  it('appends a created row and resolves true', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse(PADDLING, { status: 201 }));

    let ok;
    await act(async () => { ok = await result.current.createItem({ name: 'Paddling' }); });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(ENDPOINT, expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ name: 'Paddling' })
    }));
    expect(result.current.items).toEqual([HIKING, BIKING, PADDLING]);
    expect(result.current.saving).toBe(false);
  });

  it('surfaces the server message on a non-2xx create and leaves items alone', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ error: 'Name already exists' }, { status: 409 }));

    let ok;
    await act(async () => { ok = await result.current.createItem({ name: 'Hiking' }); });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Name already exists');
    expect(result.current.items).toEqual([HIKING, BIKING]);
    expect(result.current.saving).toBe(false);
  });

  it('falls back to a generic message when the server sends none', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({}, { status: 500 }));

    await act(async () => { await result.current.createItem({ name: 'X' }); });

    expect(result.current.error).toBe('Failed to add activity');
  });

  it('reports a network error on create', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    let ok;
    await act(async () => { ok = await result.current.createItem({ name: 'X' }); });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Failed to add activity: offline');
    expect(result.current.saving).toBe(false);
  });

  it('replaces the updated row in place', async () => {
    const { result } = await renderLoaded();
    const renamed = { id: 1, name: 'Hiking & Walking' };
    fetchMock.mockResolvedValueOnce(fetchResponse(renamed));

    let ok;
    await act(async () => { ok = await result.current.updateItem(1, { name: renamed.name }); });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(`${ENDPOINT}/1`, expect.objectContaining({ method: 'PUT' }));
    expect(result.current.items).toEqual([renamed, BIKING]);
  });

  it('surfaces the server message on a non-2xx update', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ error: 'Not found' }, { status: 404 }));

    let ok;
    await act(async () => { ok = await result.current.updateItem(9, { name: 'Y' }); });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Not found');
    expect(result.current.items).toEqual([HIKING, BIKING]);
  });

  it('clears a previous error after a successful save', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ error: 'bad' }, { status: 400 }));
    await act(async () => { await result.current.createItem({}); });
    expect(result.current.error).toBe('bad');

    fetchMock.mockResolvedValueOnce(fetchResponse(PADDLING));
    await act(async () => { await result.current.createItem({ name: 'Paddling' }); });
    expect(result.current.error).toBeNull();
  });
});

describe('useOrderedAdminList delete', () => {
  it('does nothing when the confirm is cancelled', async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    const { result } = await renderLoaded();

    await act(async () => { await result.current.deleteItem(1, 'Hiking'); });

    expect(confirmMock).toHaveBeenCalledWith('Delete activity "Hiking"? This cannot be undone.');
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial load
    expect(result.current.items).toEqual([HIKING, BIKING]);
  });

  it('removes the row after a confirmed delete', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ success: true }));

    await act(async () => { await result.current.deleteItem(1, 'Hiking'); });

    expect(fetchMock).toHaveBeenLastCalledWith(`${ENDPOINT}/1`, { method: 'DELETE', credentials: 'include' });
    expect(result.current.items).toEqual([BIKING]);
    expect(result.current.error).toBeNull();
  });

  it('keeps the row and reports the server message when delete fails', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ error: 'In use by 4 POIs' }, { status: 409 }));

    await act(async () => { await result.current.deleteItem(1, 'Hiking'); });

    expect(result.current.items).toEqual([HIKING, BIKING]);
    expect(result.current.error).toBe('In use by 4 POIs');
  });
});

describe('useOrderedAdminList saveOrder', () => {
  it('applies the order, sends the ids, and clears a prior error', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ error: 'bad' }, { status: 400 }));
    await act(async () => { await result.current.createItem({}); });
    expect(result.current.error).toBe('bad');

    fetchMock.mockResolvedValueOnce(fetchResponse({ success: true }));
    await act(async () => { await result.current.saveOrder([BIKING, HIKING]); });

    expect(fetchMock).toHaveBeenLastCalledWith(`${ENDPOINT}/reorder`, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ orderedIds: [2, 1] })
    }));
    expect(result.current.items).toEqual([BIKING, HIKING]);
    expect(result.current.error).toBeNull();
  });

  it('reports the server message when the reorder is rejected', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ error: 'Reorder locked' }, { status: 423 }));

    await act(async () => { await result.current.saveOrder([BIKING, HIKING]); });

    expect(result.current.error).toBe('Reorder locked');
    expect(result.current.items).toEqual([HIKING, BIKING]);
  });

  it('reports a network error on reorder', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await act(async () => { await result.current.saveOrder([BIKING, HIKING]); });

    expect(result.current.error).toBe('Failed to save order: offline');
    expect(result.current.items).toEqual([HIKING, BIKING]);
  });

  it('does not undo a newer reorder when an older one fails late', async () => {
    const { result } = await renderLoaded([HIKING, BIKING, PADDLING]);
    let rejectFirst;
    fetchMock
      .mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(fetchResponse({ success: true }));

    let first;
    act(() => { first = result.current.saveOrder([BIKING, HIKING, PADDLING]); });
    await act(async () => { await result.current.saveOrder([PADDLING, BIKING, HIKING]); });
    await act(async () => { rejectFirst(new Error('timeout')); await first; });

    expect(result.current.items).toEqual([PADDLING, BIKING, HIKING]);
    expect(result.current.error).toBe('Failed to save order: timeout');
  });

  it('keeps the new order when the reorder succeeds', async () => {
    const { result } = await renderLoaded();
    fetchMock.mockResolvedValueOnce(fetchResponse({ success: true }));

    await act(async () => { await result.current.saveOrder([BIKING, HIKING]); });

    expect(result.current.items).toEqual([BIKING, HIKING]);
  });
});
