import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openPoiViaPermalink } from './utils/uiHelpers.js';

const timeout = () => Object.assign(new Error('Timeout 5000ms exceeded'), { name: 'TimeoutError' });

function mockPage(waitResults) {
  const results = [...waitResults];
  return {
    goto: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {
      const next = results.shift();
      if (next instanceof Error) throw next;
    })
  };
}

describe('openPoiViaPermalink', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => [{ name: 'Brandywine Falls' }, { name: 'Everett Covered Bridge' }, { name: 'Boston Store' }]
    })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips a candidate whose sidebar times out', async () => {
    const page = mockPage([timeout(), undefined]);
    const poi = await openPoiViaPermalink(page, 'http://app');
    expect(poi.name).toBe('Everett Covered Bridge');
    expect(page.goto).toHaveBeenLastCalledWith('http://app/everett-covered-bridge', { waitUntil: 'networkidle' });
  });

  it('rethrows errors other than a selector timeout', async () => {
    const page = mockPage([new Error('Target page, context or browser has been closed')]);
    await expect(openPoiViaPermalink(page, 'http://app')).rejects.toThrow('has been closed');
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it('skips candidates the accept check rejects', async () => {
    const page = mockPage([]);
    const accept = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const poi = await openPoiViaPermalink(page, 'http://app', { accept });
    expect(poi.name).toBe('Everett Covered Bridge');
  });

  it('returns null when no candidate opens', async () => {
    const page = mockPage([timeout(), timeout(), timeout()]);
    expect(await openPoiViaPermalink(page, 'http://app')).toBeNull();
  });

  it('only tries candidates that pass the filter', async () => {
    const page = mockPage([]);
    const poi = await openPoiViaPermalink(page, 'http://app', { filter: d => d.name.startsWith('Boston') });
    expect(poi.name).toBe('Boston Store');
    expect(page.goto).toHaveBeenCalledTimes(1);
  });
});
