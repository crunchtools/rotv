/**
 * extractPageContent renders each network route on the right browser: direct and
 * IPRoyal on the unproxied browser (IPRoyal as a per-context proxy), everything
 * else on the ExpressVPN browser.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const newContext = vi.fn(async () => { throw new Error('stop after context options'); });
const acquireBrowser = vi.fn(async () => ({ browser: { newContext, version: () => '140.0.0.0' }, acquisitionId: 1 }));
const releaseBrowser = vi.fn();
vi.mock('../services/browserPool.js', () => ({ acquireBrowser, releaseBrowser, chromeUserAgent: () => 'UA' }));

const { extractPageContent } = await import('../services/contentExtractor.js');

const savedResidential = process.env.RESIDENTIAL_PROXY;

afterEach(() => {
  vi.clearAllMocks();
  if (savedResidential === undefined) delete process.env.RESIDENTIAL_PROXY;
  else process.env.RESIDENTIAL_PROXY = savedResidential;
});

describe('extractPageContent egress', () => {
  it('uses the ExpressVPN browser by default and the unproxied one for direct', async () => {
    await extractPageContent('https://stanhywet.org/');
    await extractPageContent('https://newfranklin.org/', { egress: 'direct' });
    expect(acquireBrowser.mock.calls.map(([key]) => key)).toEqual(['vpn', 'direct']);
    for (const [options] of newContext.mock.calls) expect(options).not.toHaveProperty('proxy');
  });

  it('puts IPRoyal on the unproxied browser as a context proxy', async () => {
    process.env.RESIDENTIAL_PROXY = 'http://user:pass_country-us@geo.example.com:12321';
    await extractPageContent('https://www.cvsr.org/excursions', { egress: 'residential' });
    expect(acquireBrowser).toHaveBeenCalledWith('direct');
    expect(newContext.mock.calls[0][0].proxy).toEqual({
      server: 'http://geo.example.com:12321', bypass: '<-loopback>', username: 'user', password: 'pass_country-us'
    });
  });

  it('releases the browser even when the context cannot be created', async () => {
    await extractPageContent('https://stanhywet.org/');
    expect(releaseBrowser).toHaveBeenCalledWith(1);
  });
});
