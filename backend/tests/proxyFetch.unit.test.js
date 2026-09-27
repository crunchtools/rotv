import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const undiciFetch = vi.fn(async () => 'via-proxy');
const ProxyAgent = vi.fn(function ProxyAgent(opts) { this.proxy = opts.uri; });
vi.mock('undici', () => ({ fetch: undiciFetch, ProxyAgent }));

const { proxyFetch } = await import('../utils/proxyFetch.js');

const savedProxy = process.env.PLAYWRIGHT_PROXY;
const globalFetch = vi.fn(async () => 'direct');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', globalFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedProxy === undefined) delete process.env.PLAYWRIGHT_PROXY;
  else process.env.PLAYWRIGHT_PROXY = savedProxy;
});

describe('proxyFetch', () => {
  it('uses the global fetch when no proxy is configured', async () => {
    delete process.env.PLAYWRIGHT_PROXY;
    expect(await proxyFetch('https://example.org/', { method: 'HEAD' })).toBe('direct');
    expect(globalFetch).toHaveBeenCalledWith('https://example.org/', { method: 'HEAD' });
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('routes through a ProxyAgent for PLAYWRIGHT_PROXY and reuses it', async () => {
    process.env.PLAYWRIGHT_PROXY = 'http://vpn.example:8888';
    expect(await proxyFetch('https://example.org/', { method: 'GET' })).toBe('via-proxy');
    await proxyFetch('https://example.org/two');
    expect(ProxyAgent).toHaveBeenCalledTimes(1);
    expect(ProxyAgent).toHaveBeenCalledWith({ uri: 'http://vpn.example:8888', proxyTunnel: false });
    const [, init] = undiciFetch.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(init.dispatcher.proxy).toBe('http://vpn.example:8888');
    expect(undiciFetch.mock.calls[1][1].dispatcher).toBe(init.dispatcher);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
