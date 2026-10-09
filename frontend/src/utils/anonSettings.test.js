import { describe, it, expect, vi, beforeEach } from 'vitest';
import { remapMergedPoiIds, readFavorites, readVisited } from './anonSettings';

function respond(body, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => body });
}

describe('remapMergedPoiIds', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('asks nothing when the device holds no places', async () => {
    vi.stubGlobal('fetch', respond({}));
    expect(await remapMergedPoiIds()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rewrites a merged id in both lists and drops the duplicate it creates', async () => {
    localStorage.setItem('rotv-favorites', JSON.stringify([5535, 5811, 12]));
    localStorage.setItem('rotv-visited', JSON.stringify([5535]));
    vi.stubGlobal('fetch', respond({ 5535: 5811 }));

    expect(await remapMergedPoiIds()).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe('/api/pois/merged?ids=5535,5811,12');
    expect(readFavorites()).toEqual([5811, 12]);
    expect(readVisited()).toEqual([5811]);
  });

  it('leaves the lists alone when nothing was merged', async () => {
    localStorage.setItem('rotv-favorites', JSON.stringify([12]));
    vi.stubGlobal('fetch', respond({}));
    expect(await remapMergedPoiIds()).toBe(false);
    expect(readFavorites()).toEqual([12]);
  });

  it('leaves the lists alone when the server refuses or is unreachable', async () => {
    localStorage.setItem('rotv-favorites', JSON.stringify([5535]));
    vi.stubGlobal('fetch', respond({}, false));
    expect(await remapMergedPoiIds()).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await remapMergedPoiIds()).toBe(false);
    expect(readFavorites()).toEqual([5535]);
  });
});
