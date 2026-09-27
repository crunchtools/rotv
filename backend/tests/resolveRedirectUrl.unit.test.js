import { describe, it, expect, beforeEach, vi } from 'vitest';

const proxyFetch = vi.fn();
vi.mock('../utils/proxyFetch.js', () => ({ proxyFetch }));

const { resolveRedirectUrl } = await import('../services/newsService.js');

// Block body: a function returned from beforeEach is run as its cleanup.
beforeEach(() => { proxyFetch.mockReset(); });

describe('resolveRedirectUrl', () => {
  it('follows a redirect link with a proxied HEAD and returns the final URL', async () => {
    proxyFetch.mockResolvedValue({ url: 'https://www.nps.gov/cuva/news.htm' });
    expect(await resolveRedirectUrl('https://r20.rs6.net/tn.jsp?f=abc')).toBe('https://www.nps.gov/cuva/news.htm');
    const [url, init] = proxyFetch.mock.calls[0];
    expect(url).toBe('https://r20.rs6.net/tn.jsp?f=abc');
    expect(init).toMatchObject({ method: 'HEAD', redirect: 'follow' });
  });

  it('returns null when the redirect goes nowhere or the proxied request fails', async () => {
    proxyFetch.mockResolvedValueOnce({ url: 'https://example.com/redirect?to=x' });
    expect(await resolveRedirectUrl('https://example.com/redirect?to=x')).toBeNull();
    proxyFetch.mockRejectedValueOnce(new Error('Proxy response (403) !== 200'));
    expect(await resolveRedirectUrl('https://example.com/redirect?to=y')).toBeNull();
  });

  it('returns direct URLs untouched without a request', async () => {
    expect(await resolveRedirectUrl('https://www.nps.gov/cuva/')).toBe('https://www.nps.gov/cuva/');
    expect(await resolveRedirectUrl('N/A')).toBeNull();
    expect(proxyFetch).not.toHaveBeenCalled();
  });
});
