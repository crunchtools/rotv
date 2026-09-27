import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let geoResponse;
const probeStub = {
  request: { get: vi.fn(async () => ({ json: async () => geoResponse() })) },
  close: vi.fn(async () => {})
};
const makeBrowser = () => ({ newContext: vi.fn(async () => probeStub), version: () => '145.0.7632.6' });

vi.mock('playwright', () => ({ chromium: { launch: vi.fn(async () => makeBrowser()) } }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => false) }));

const { chromium } = await import('playwright');
const { existsSync } = await import('node:fs');
const {
  hasDisplay, isValidTimezone, launchHumanBrowser, egressTimezone, humanContextOptions,
  resetTimezoneCache, FALLBACK_TIMEZONE
} = await import('../services/humanBrowser.js');
const { chromeUserAgent } = await import('../services/browserPool.js');

const savedEnv = { DISPLAY: process.env.DISPLAY, PLAYWRIGHT_PROXY: process.env.PLAYWRIGHT_PROXY };

beforeEach(() => {
  vi.clearAllMocks();
  resetTimezoneCache();
  geoResponse = () => ({ timezone: 'America/Chicago' });
  existsSync.mockReturnValue(false);
  delete process.env.DISPLAY;
  delete process.env.PLAYWRIGHT_PROXY;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('hasDisplay', () => {
  it('needs both a well-formed DISPLAY and its X socket', () => {
    expect(hasDisplay(undefined)).toBe(false);
    expect(hasDisplay('remote:0')).toBe(false);
    expect(hasDisplay(':0')).toBe(false);
    existsSync.mockReturnValue(true);
    expect(hasDisplay(':0')).toBe(true);
    expect(existsSync).toHaveBeenLastCalledWith('/tmp/.X11-unix/X0');
    expect(hasDisplay(':1.0')).toBe(true);
    expect(existsSync).toHaveBeenLastCalledWith('/tmp/.X11-unix/X1');
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA zones only', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });
});

describe('launchHumanBrowser', () => {
  it('launches headed through the proxy when the display exists', async () => {
    process.env.DISPLAY = ':0';
    process.env.PLAYWRIGHT_PROXY = 'http://expressvpn.example:8888';
    existsSync.mockReturnValue(true);
    await launchHumanBrowser();
    const opts = chromium.launch.mock.calls[0][0];
    expect(opts.headless).toBe(false);
    expect(opts.proxy).toEqual({ server: 'http://expressvpn.example:8888' });
    expect(opts.args).toContain('--disable-blink-features=AutomationControlled');
  });

  it('falls back to headless, unproxied when neither is configured', async () => {
    await launchHumanBrowser();
    const opts = chromium.launch.mock.calls[0][0];
    expect(opts.headless).toBe(true);
    expect(opts.proxy).toBeUndefined();
  });
});

describe('egressTimezone', () => {
  it('looks up the zone through the browser and caches it', async () => {
    const browser = makeBrowser();
    expect(await egressTimezone(browser)).toBe('America/Chicago');
    expect(await egressTimezone(browser)).toBe('America/Chicago');
    expect(probeStub.request.get).toHaveBeenCalledTimes(1);
    expect(probeStub.close).toHaveBeenCalledTimes(1);
  });

  it('falls back without caching on a bad or failed lookup', async () => {
    const browser = makeBrowser();
    geoResponse = () => ({ timezone: 'Nowhere/Land' });
    expect(await egressTimezone(browser)).toBe(FALLBACK_TIMEZONE);
    probeStub.request.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await egressTimezone(browser)).toBe(FALLBACK_TIMEZONE);
    geoResponse = () => ({ timezone: 'America/Chicago' });
    expect(await egressTimezone(browser)).toBe('America/Chicago');
    expect(probeStub.close).toHaveBeenCalledTimes(3);
  });
});

describe('humanContextOptions', () => {
  it('leaves the UA native on a headed browser', async () => {
    process.env.DISPLAY = ':0';
    existsSync.mockReturnValue(true);
    const browser = await launchHumanBrowser();
    const opts = await humanContextOptions(browser, { viewport: { width: 800, height: 900 } });
    expect(opts).toEqual({ locale: 'en-US', timezoneId: 'America/Chicago', viewport: { width: 800, height: 900 } });
  });

  it('sets a version-matched UA on a headless browser', async () => {
    const browser = await launchHumanBrowser();
    const opts = await humanContextOptions(browser);
    expect(opts.userAgent).toContain('Chrome/145.0.0.0');
    expect(opts.userAgent).not.toContain('Headless');
  });
});

describe('chromeUserAgent', () => {
  it('uses the running Chromium major version', () => {
    expect(chromeUserAgent({ version: () => '145.0.7632.6' })).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
    );
  });
});
