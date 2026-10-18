/**
 * The browser pool keeps one shared browser per egress: 'vpn' through
 * PLAYWRIGHT_PROXY, 'direct' with no proxy (egressRoutes.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const launch = vi.fn(async (opts) => ({
  opts,
  isConnected: () => true,
  close: vi.fn(async () => {}),
  version: () => '140.0.0.0'
}));
vi.mock('playwright', () => ({ chromium: { launch } }));
vi.mock('../services/directEgressProxy.js', () => ({ directEgressProxyUrl: vi.fn(async () => 'http://127.0.0.1:41234') }));

const { acquireBrowser, releaseBrowser, forceKill } = await import('../services/browserPool.js');

const savedProxy = process.env.PLAYWRIGHT_PROXY;

beforeEach(async () => {
  await forceKill('test reset');
  launch.mockClear();
  process.env.PLAYWRIGHT_PROXY = 'http://vpn.example:8888';
});

afterEach(async () => {
  await forceKill('test reset');
  if (savedProxy === undefined) delete process.env.PLAYWRIGHT_PROXY;
  else process.env.PLAYWRIGHT_PROXY = savedProxy;
});

describe('browserPool keys', () => {
  it('launches the default browser through ExpressVPN and the direct one through the public-only guard', async () => {
    const vpn = await acquireBrowser();
    const direct = await acquireBrowser('direct');
    expect(launch).toHaveBeenCalledTimes(2);
    expect(vpn.browser.opts.proxy).toEqual({ server: 'http://vpn.example:8888', bypass: '<-loopback>' });
    expect(direct.browser.opts.proxy).toEqual({ server: 'http://127.0.0.1:41234', bypass: '<-loopback>' });
    expect(direct.browser).not.toBe(vpn.browser);
    releaseBrowser(vpn.acquisitionId);
    releaseBrowser(direct.acquisitionId);
  });

  it('shares one browser per key', async () => {
    const a = await acquireBrowser('direct');
    const b = await acquireBrowser('direct');
    expect(a.browser).toBe(b.browser);
    expect(launch).toHaveBeenCalledTimes(1);
    releaseBrowser(a.acquisitionId);
    releaseBrowser(b.acquisitionId);
  });

  it('force-kills every browser, and a late release does not touch a relaunched one', async () => {
    const vpn = await acquireBrowser();
    const direct = await acquireBrowser('direct');
    await forceKill('test');
    expect(vpn.browser.close).toHaveBeenCalled();
    expect(direct.browser.close).toHaveBeenCalled();

    const fresh = await acquireBrowser();
    releaseBrowser(vpn.acquisitionId); // stale: its browser was killed
    const again = await acquireBrowser();
    expect(again.browser).toBe(fresh.browser);
    expect(launch).toHaveBeenCalledTimes(3);
    releaseBrowser(fresh.acquisitionId);
    releaseBrowser(again.acquisitionId);
  });

  it('launches a fresh browser when an acquire races an idle close', async () => {
    vi.useFakeTimers();
    try {
      let finishClose;
      const first = await acquireBrowser('direct');
      first.browser.close.mockImplementation(() => new Promise(resolve => { finishClose = resolve; }));
      releaseBrowser(first.acquisitionId);

      await vi.advanceTimersByTimeAsync(30_000); // idle close starts and is still pending
      expect(first.browser.close).toHaveBeenCalled();
      const second = await acquireBrowser('direct');
      expect(second.browser).not.toBe(first.browser);
      expect(launch).toHaveBeenCalledTimes(2);

      finishClose();
      releaseBrowser(second.acquisitionId);
    } finally {
      vi.useRealTimers();
    }
  });
});
