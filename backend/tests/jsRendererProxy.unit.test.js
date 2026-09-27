import { describe, it, expect, beforeEach, vi } from 'vitest';

const proxyFetch = vi.fn();
vi.mock('../utils/proxyFetch.js', () => ({ proxyFetch }));

const { isJavaScriptHeavySite } = await import('../services/jsRenderer.js');

const response = ({ headers = {}, body = '' } = {}) => ({
  headers: { get: name => headers[name.toLowerCase()] ?? null },
  text: async () => body
});

// Block body: a function returned from beforeEach is run as its cleanup.
beforeEach(() => { proxyFetch.mockReset(); });

describe('isJavaScriptHeavySite content probe', () => {
  it('fetches the target through the scraper proxy and detects Wix by header', async () => {
    proxyFetch.mockResolvedValue(response({ headers: { 'x-wix-request-id': 'abc' } }));
    expect(await isJavaScriptHeavySite('https://trails.example.org/', { checkContent: true })).toBe(true);
    const [url, init] = proxyFetch.mock.calls[0];
    expect(url).toBe('https://trails.example.org/');
    expect(init.method).toBe('GET');
    expect(init.headers['User-Agent']).toMatch(/Chrome\/\d+/);
  });

  it('falls back to rendering when the proxied probe fails', async () => {
    proxyFetch.mockRejectedValue(new Error('Proxy response (403) !== 200'));
    expect(await isJavaScriptHeavySite('https://trails.example.org/', { checkContent: true })).toBe(true);
  });

  it('skips the probe for listed domains and when checkContent is off', async () => {
    expect(await isJavaScriptHeavySite('https://www.facebook.com/x', { checkContent: true })).toBe(true);
    expect(await isJavaScriptHeavySite('https://trails.example.org/', { checkContent: false })).toBe(false);
    expect(proxyFetch).not.toHaveBeenCalled();
  });
});
