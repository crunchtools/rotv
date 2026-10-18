import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const undiciFetch = vi.fn(async () => 'via-proxy');
const ProxyAgent = vi.fn(function ProxyAgent(opts) { this.proxy = opts.uri; });
const Agent = vi.fn(function Agent(opts) { this.direct = true; this.lookup = opts.connect.lookup; });
vi.mock('undici', () => ({ fetch: undiciFetch, ProxyAgent, Agent }));
vi.mock('../utils/publicAddress.js', () => ({ isPublicUrl: vi.fn(async (url) => !url.includes('127.0.0.1')), publicLookup: vi.fn() }));

const { proxyFetch } = await import('../utils/proxyFetch.js');
const { setEgressConfig, resetEgressConfig } = await import('../services/egressRoutes.js');

const savedProxy = process.env.PLAYWRIGHT_PROXY;
const savedResidential = process.env.RESIDENTIAL_PROXY;
const globalFetch = vi.fn(async () => 'direct');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', globalFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedProxy === undefined) delete process.env.PLAYWRIGHT_PROXY;
  else process.env.PLAYWRIGHT_PROXY = savedProxy;
  if (savedResidential === undefined) delete process.env.RESIDENTIAL_PROXY;
  else process.env.RESIDENTIAL_PROXY = savedResidential;
  resetEgressConfig();
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

  it('fetches a domain routed direct over the public-only agent, checking each redirect hop', async () => {
    process.env.PLAYWRIGHT_PROXY = 'http://vpn.example:8888';
    setEgressConfig({ entries: { 'newfranklin.org': { route: 'direct', source: 'manual', updatedAt: 0 } } });
    const hop = (status, location) => ({ status, headers: { get: (h) => (h === 'location' ? location : null) } });
    undiciFetch
      .mockResolvedValueOnce(hop(301, 'https://newfranklin.org/1222/Community-Events'))
      .mockResolvedValueOnce(hop(200, null));

    const res = await proxyFetch('https://www.newfranklin.org/1222', { method: 'HEAD' });

    expect(res.url).toBe('https://newfranklin.org/1222/Community-Events');
    expect(undiciFetch.mock.calls.map(([u, init]) => [u, init.redirect, init.dispatcher.direct]))
      .toEqual([['https://www.newfranklin.org/1222', 'manual', true], ['https://newfranklin.org/1222/Community-Events', 'manual', true]]);
    expect(globalFetch).not.toHaveBeenCalled();

    undiciFetch.mockReset();
    undiciFetch.mockResolvedValueOnce(hop(302, 'https://other.example.org/landing')).mockResolvedValueOnce(hop(200, null));
    await proxyFetch('https://www.newfranklin.org/y', { method: 'GET', headers: { Cookie: 'a=1', 'User-Agent': 'UA' } });
    const second = new Headers(undiciFetch.mock.calls[1][1].headers);
    expect(second.get('cookie')).toBeNull();
    expect(second.get('user-agent')).toBe('UA');

    undiciFetch.mockReset();
    undiciFetch.mockResolvedValueOnce(hop(302, 'https://newfranklin.org/thanks')).mockResolvedValueOnce(hop(200, null));
    await proxyFetch('https://newfranklin.org/form', { method: 'POST', body: 'a=1' });
    expect(undiciFetch.mock.calls[1][1].method).toBe('GET');
    expect(undiciFetch.mock.calls[1][1]).not.toHaveProperty('body');

    undiciFetch.mockReset();
    undiciFetch.mockResolvedValueOnce(hop(307, 'https://newfranklin.org/again')).mockResolvedValueOnce(hop(200, null));
    await proxyFetch('https://newfranklin.org/form', { method: 'POST', body: 'a=1' });
    expect(undiciFetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: 'a=1' });

    undiciFetch.mockReset();
    undiciFetch.mockResolvedValueOnce(hop(301, 'https://newfranklin.org/moved'));
    await expect(proxyFetch('https://newfranklin.org/x', { redirect: 'error' })).rejects.toThrow(/redirect: 'error'/);

    undiciFetch.mockReset();
    undiciFetch.mockResolvedValueOnce(hop(302, 'http://127.0.0.1:8019/health'));
    await expect(proxyFetch('https://www.newfranklin.org/x')).rejects.toThrow(/non-public address/);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it('guards a direct route even without PLAYWRIGHT_PROXY', async () => {
    delete process.env.PLAYWRIGHT_PROXY;
    setEgressConfig({ entries: { 'newfranklin.org': { route: 'direct', source: 'manual', updatedAt: 0 } } });
    undiciFetch.mockResolvedValueOnce({ status: 200, headers: { get: () => null } });
    await proxyFetch('https://newfranklin.org/');
    expect(undiciFetch.mock.calls[0][1].dispatcher.direct).toBe(true);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('keeps a non-public address on the proxy even when routed direct', async () => {
    process.env.PLAYWRIGHT_PROXY = 'http://vpn.example:8888';
    setEgressConfig({ defaultRoute: 'direct' });
    await proxyFetch('http://127.0.0.1:8019/health');
    expect(globalFetch).not.toHaveBeenCalled();
    expect(undiciFetch.mock.calls[0][1].dispatcher.proxy).toBe('http://vpn.example:8888');
  });

  it('uses the residential proxy for a residential domain once it is configured', async () => {
    process.env.PLAYWRIGHT_PROXY = 'http://vpn.example:8888';
    setEgressConfig({ entries: { 'cvsr.org': { route: 'residential', source: 'manual', updatedAt: 0 } } });
    delete process.env.RESIDENTIAL_PROXY;
    await proxyFetch('https://www.cvsr.org/excursions');
    expect(undiciFetch.mock.calls[0][1].dispatcher.proxy).toBe('http://vpn.example:8888');

    process.env.RESIDENTIAL_PROXY = 'http://user:pass@geo.example.com:12321';
    await proxyFetch('https://www.cvsr.org/excursions');
    expect(ProxyAgent).toHaveBeenLastCalledWith({ uri: 'http://user:pass@geo.example.com:12321' });
    expect(undiciFetch.mock.calls[1][1].dispatcher.proxy).toBe('http://user:pass@geo.example.com:12321');
  });
});
