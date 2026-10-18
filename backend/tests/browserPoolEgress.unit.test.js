/**
 * The shared browser launches with egress_routes' direct domains as its proxy
 * bypass list, and relaunches for a changed list only while it is idle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const launch = vi.fn(async () => ({
  isConnected: () => true,
  close: vi.fn(async () => {}),
  version: () => '140.0.0.0'
}));
vi.mock('playwright', () => ({ chromium: { launch } }));

const { acquireBrowser, releaseBrowser, forceKill } = await import('../services/browserPool.js');
const { setEgressRoutes } = await import('../services/egressRoutes.js');

const savedProxy = process.env.PLAYWRIGHT_PROXY;

beforeEach(async () => {
  await forceKill('test reset');
  launch.mockClear();
  process.env.PLAYWRIGHT_PROXY = 'http://vpn.example:8888';
});

afterEach(async () => {
  await forceKill('test reset');
  setEgressRoutes({});
  if (savedProxy === undefined) delete process.env.PLAYWRIGHT_PROXY;
  else process.env.PLAYWRIGHT_PROXY = savedProxy;
});

describe('browserPool egress', () => {
  it('launches through the proxy with the direct domains bypassed', async () => {
    setEgressRoutes({ 'newfranklin.org': 'direct', 'cvsr.org': 'residential' });
    const { acquisitionId } = await acquireBrowser();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][0].proxy).toEqual({
      server: 'http://vpn.example:8888', bypass: 'newfranklin.org,.newfranklin.org'
    });
    releaseBrowser(acquisitionId);
  });

  it('omits the bypass list when nothing is routed direct', async () => {
    const { acquisitionId } = await acquireBrowser();
    expect(launch.mock.calls[0][0].proxy).toEqual({ server: 'http://vpn.example:8888' });
    releaseBrowser(acquisitionId);
  });

  it('relaunches for a changed direct list only once the browser is idle', async () => {
    const first = await acquireBrowser();

    setEgressRoutes({ 'newfranklin.org': 'direct' });
    const second = await acquireBrowser();
    expect(second.browser).toBe(first.browser);
    expect(launch).toHaveBeenCalledTimes(1);

    releaseBrowser(first.acquisitionId);
    releaseBrowser(second.acquisitionId);
    const third = await acquireBrowser();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(first.browser.close).toHaveBeenCalled();
    expect(launch.mock.calls[1][0].proxy.bypass).toBe('newfranklin.org,.newfranklin.org');
    releaseBrowser(third.acquisitionId);
  });
});
