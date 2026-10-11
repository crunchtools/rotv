import { describe, it, expect, vi, beforeEach } from 'vitest';
import { remapMergedPoiIds, readFavorites, readVisited, syncAnonSettings, readContact, readListChoices } from './anonSettings';

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

describe('syncAnonSettings preferences (spec 050)', () => {
  const sentBody = () => JSON.parse(fetch.mock.calls[0][1].body);

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('sends no preferences when the device holds none', async () => {
    localStorage.setItem('rotv-favorites', '[12]');
    vi.stubGlobal('fetch', respond({ synced: {} }));

    await syncAnonSettings();

    expect(sentBody()).toEqual({ favorites: [12] });
  });

  it('sends the free-choice picks alone, and together with the list sort', async () => {
    localStorage.setItem('rotv-list-choices', JSON.stringify({ 1: 1044 }));
    vi.stubGlobal('fetch', respond({ synced: {} }));
    await syncAnonSettings();
    expect(sentBody()).toEqual({ preferences: { listChoices: { 1: 1044 } } });

    localStorage.setItem('rotv-list-sort', 'park-desc');
    vi.stubGlobal('fetch', respond({ synced: {} }));
    await syncAnonSettings();
    expect(sentBody()).toEqual({ preferences: { listSort: 'park-desc', listChoices: { 1: 1044 } } });
    // Both are still read from the device afterwards
    expect(readListChoices()).toEqual({ 1: 1044 });
    expect(localStorage.getItem('rotv-list-sort')).toBe('park-desc');
  });

  it('sends contact details and takes them off the device once the account has them', async () => {
    const contact = { firstName: 'Scott', address: '1 Main St', phone: '330-555-0100' };
    localStorage.setItem('rotv-contact', JSON.stringify(contact));
    vi.stubGlobal('fetch', respond({ synced: {} }));

    expect(await syncAnonSettings()).toEqual({ synced: true });

    expect(sentBody()).toEqual({ preferences: { contact } });
    expect(readContact()).toEqual({});
  });

  it('keeps contact details on the device when the sync is refused or fails', async () => {
    const contact = { firstName: 'Scott' };
    localStorage.setItem('rotv-contact', JSON.stringify(contact));

    vi.stubGlobal('fetch', respond({}, false));
    await syncAnonSettings();
    expect(readContact()).toEqual(contact);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await syncAnonSettings()).toEqual({ synced: false });
    expect(readContact()).toEqual(contact);
  });

  it('ignores stored details that are not an object', () => {
    localStorage.setItem('rotv-contact', '["Scott"]');
    localStorage.setItem('rotv-list-choices', 'not json');
    expect(readContact()).toEqual({});
    expect(readListChoices()).toEqual({});
  });
});

