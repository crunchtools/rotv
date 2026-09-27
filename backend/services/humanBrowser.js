import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { LAUNCH_OPTIONS, chromeUserAgent } from './browserPool.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('HumanBrowser');

/**
 * The browser for sites that fingerprint visitors (Facebook login and scrape).
 *
 * Headed Chromium on the container's virtual display (rotv-display.service:
 * headless Weston + Xwayland), egressing through the same ExpressVPN proxy as
 * every other scraper. Headed Chromium reports its own UA, client hints and
 * plugins, so those aren't overridden; the context sets only the locale (en-US)
 * and the timezone, matched to the egress IP. The remote login and the scraper both launch through here so the
 * session is created and reused by the same-looking browser from the same exit.
 *
 * Without a display (local dev, CI) it falls back to headless with a UA that
 * matches the real Chromium version.
 */

const GEO_URL = 'https://ipinfo.io/json';
const GEO_TIMEOUT_MS = 10000;
const GEO_CACHE_MS = 60 * 60 * 1000;
// Fixed by the X11 protocol, not configurable: where display :N's socket lives.
const X11_SOCKET_DIR = '/tmp/.X11-unix';
const DISPLAY_WAIT_MS = 15000;
const DISPLAY_POLL_MS = 250;
export const FALLBACK_TIMEZONE = 'America/New_York';

let timezoneCache = null; // { timezone, at }
const headedBrowsers = new WeakSet();
let displayTimedOut = false; // DISPLAY set but never came up (dev builds without weston): wait once, not per launch

/**
 * @param {string|undefined} display - e.g. ":0" or ":1.0"
 * @returns {boolean} true when that local X display's socket exists
 */
export function hasDisplay(display = process.env.DISPLAY) {
  const match = /^:(\d+)(\.\d+)?$/.exec(display || '');
  return Boolean(match) && existsSync(`${X11_SOCKET_DIR}/X${match[1]}`);
}

/**
 * Launch the fingerprint-consistent browser: headed when a display exists
 * (waiting up to 15s for it if DISPLAY is set but the socket isn't up yet),
 * proxied through PLAYWRIGHT_PROXY when set.
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchHumanBrowser() {
  // Fix: wait for Weston's socket when DISPLAY is configured, so a scrape during container boot doesn't go headless (PR #673 review)
  let headed = hasDisplay();
  if (!headed && process.env.DISPLAY && !displayTimedOut) {
    const deadline = Date.now() + DISPLAY_WAIT_MS;
    while (!headed && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, DISPLAY_POLL_MS));
      headed = hasDisplay();
    }
    displayTimedOut = !headed;
  }
  if (!headed) logger.warn(`No X display (DISPLAY=${process.env.DISPLAY || 'unset'}); launching headless (expected only in dev/CI)`);
  const opts = { ...LAUNCH_OPTIONS, headless: !headed };
  if (process.env.PLAYWRIGHT_PROXY) opts.proxy = { server: process.env.PLAYWRIGHT_PROXY };
  const browser = await chromium.launch(opts);
  if (headed) headedBrowsers.add(browser);
  return browser;
}

/** Test hook: forget the cached egress timezone and display timeout. */
export function resetHumanBrowserState() {
  timezoneCache = null;
  displayTimedOut = false;
}

/**
 * Context options for a browser from launchHumanBrowser(). The timezone is
 * the egress IP's, looked up by loading GEO_URL in a throwaway page so the
 * request takes the browser's proxy. Successful lookups are cached for an
 * hour; a failed one uses FALLBACK_TIMEZONE and is retried next time.
 * @param {import('playwright').Browser} browser
 * @param {object} [extra] - merged last (e.g. { viewport })
 * @returns {Promise<object>} options for browser.newContext
 */
export async function humanContextOptions(browser, extra = {}) {
  let timezoneId = FALLBACK_TIMEZONE;
  if (timezoneCache && Date.now() - timezoneCache.at < GEO_CACHE_MS) {
    timezoneId = timezoneCache.timezone;
  } else {
    let probe = null;
    try {
      probe = await browser.newContext();
      const page = await probe.newPage();
      // Fix: a page navigation, not probe.request, so the lookup surely goes through the launch proxy (PR #673 review)
      const res = await page.goto(GEO_URL, { timeout: GEO_TIMEOUT_MS });
      if (!res?.ok()) throw new Error(`geo lookup HTTP ${res?.status()}`);
      const { timezone: reported } = await res.json();
      if (typeof reported !== 'string' || !reported) throw new Error(`no timezone in geo response (${reported})`);
      // Fix: accept aliases (Asia/Calcutta, Etc/UTC) — DateTimeFormat throws RangeError on unknown zones, caught below (PR #673 review)
      const timezone = new Intl.DateTimeFormat('en-US', { timeZone: reported }).resolvedOptions().timeZone;
      timezoneCache = { timezone, at: Date.now() };
      timezoneId = timezone;
      logger.info(`Egress timezone: ${timezone}`);
    } catch (err) {
      logger.warn(`Egress timezone lookup failed, using ${FALLBACK_TIMEZONE}: ${err.message}`);
    } finally {
      if (probe) await probe.close().catch(err => logger.debug(`Probe context close failed: ${err.message}`));
    }
  }
  const options = { locale: 'en-US', timezoneId };
  // Headless Chromium says "HeadlessChrome"; headed reports the right UA natively.
  if (!headedBrowsers.has(browser)) options.userAgent = chromeUserAgent(browser);
  return { ...options, ...extra };
}
