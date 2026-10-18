/**
 * extractPageContent gives a residential-routed URL its own context proxy; every
 * other route inherits the shared browser's proxy (or its direct bypass list).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const newContext = vi.fn(async () => { throw new Error('stop after context options'); });
vi.mock('../services/browserPool.js', () => ({
  acquireBrowser: vi.fn(async () => ({ browser: { newContext, version: () => '140.0.0.0' }, acquisitionId: 1 })),
  releaseBrowser: vi.fn(),
  chromeUserAgent: () => 'UA'
}));

const { extractPageContent } = await import('../services/contentExtractor.js');
const { setEgressRoutes } = await import('../services/egressRoutes.js');

const savedResidential = process.env.RESIDENTIAL_PROXY;

afterEach(() => {
  newContext.mockClear();
  setEgressRoutes({});
  if (savedResidential === undefined) delete process.env.RESIDENTIAL_PROXY;
  else process.env.RESIDENTIAL_PROXY = savedResidential;
});

describe('extractPageContent egress', () => {
  it('sets the residential proxy on the context for a residential domain', async () => {
    process.env.RESIDENTIAL_PROXY = 'http://user:pass@geo.example.com:12321';
    setEgressRoutes({ 'cvsr.org': 'residential' });
    await extractPageContent('https://www.cvsr.org/excursions');
    expect(newContext.mock.calls[0][0].proxy).toEqual({
      server: 'http://geo.example.com:12321', username: 'user', password: 'pass'
    });
  });

  it('leaves direct, expressvpn and unconfigured residential routes on the browser proxy', async () => {
    delete process.env.RESIDENTIAL_PROXY;
    setEgressRoutes({ 'newfranklin.org': 'direct', 'cvsr.org': 'residential' });
    for (const url of ['https://newfranklin.org/1222/Community-Events', 'https://stanhywet.org/', 'https://www.cvsr.org/']) {
      await extractPageContent(url);
    }
    expect(newContext).toHaveBeenCalledTimes(3);
    for (const [options] of newContext.mock.calls) expect(options).not.toHaveProperty('proxy');
  });
});
