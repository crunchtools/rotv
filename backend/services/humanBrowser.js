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
 * plugins, so nothing is overridden; only the timezone is set, to match the
 * egress IP. The remote login and the scraper both launch through here so the
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

// Fix: wait for Weston's socket when DISPLAY is configured, so a scrape during container boot doesn't go headless (PR #673 review)
async function waitForDisplay() {
  if (hasDisplay()) return true;
  if (!process.env.DISPLAY || displayTimedOut) return false;
  const deadline = Date.now() + DISPLAY_WAIT_MS;
  while (!hasDisplay()) {
    if (Date.now() >= deadline) {
      displayTimedOut = true;
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, DISPLAY_POLL_MS));
  }
  return true;
}

/**
 * @param {unknown} tz
 * @returns {boolean} true for a canonical IANA zone known to this runtime
 */
export function isValidTimezone(tz) {
  return typeof tz === 'string' && Intl.supportedValuesOf('timeZone').includes(tz);
}

/**
 * Launch the fingerprint-consistent browser: headed when a display exists
 * (waiting up to 15s for it if DISPLAY is set but the socket isn't up yet),
 * proxied through PLAYWRIGHT_PROXY when set.
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchHumanBrowser() {
  const headed = await waitForDisplay();
  if (!headed) logger.warn(`No X display (DISPLAY=${process.env.DISPLAY || 'unset'}); launching headless (expected only in dev/CI)`);
  const opts = { ...LAUNCH_OPTIONS, headless: !headed };
  if (process.env.PLAYWRIGHT_PROXY) opts.proxy = { server: process.env.PLAYWRIGHT_PROXY };
  const browser = await chromium.launch(opts);
  if (headed) headedBrowsers.add(browser);
  return browser;
}

/**
 * Timezone of the browser's egress IP, looked up through the browser itself so
 * it sees the proxy's exit. Successful lookups are cached for an hour; failures
 * fall back to FALLBACK_TIMEZONE and are retried next time.
 * @param {import('playwright').Browser} browser
 * @returns {Promise<string>} IANA timezone
 */
export async function egressTimezone(browser) {
  if (timezoneCache && Date.now() - timezoneCache.at < GEO_CACHE_MS) return timezoneCache.timezone;
  let probe = null;
  try {
    probe = await browser.newContext();
    const res = await probe.request.get(GEO_URL, { timeout: GEO_TIMEOUT_MS });
    const { timezone } = await res.json();
    if (!isValidTimezone(timezone)) throw new Error(`no usable timezone in geo response (${timezone})`);
    timezoneCache = { timezone, at: Date.now() };
    logger.info(`Egress timezone: ${timezone}`);
    return timezone;
  } catch (err) {
    logger.warn(`Egress timezone lookup failed, using ${FALLBACK_TIMEZONE}: ${err.message}`);
    return FALLBACK_TIMEZONE;
  } finally {
    if (probe) await probe.close().catch(err => logger.debug(`Probe context close failed: ${err.message}`));
  }
}

/** Test hook: forget the cached egress timezone and display timeout. */
export function resetHumanBrowserState() {
  timezoneCache = null;
  displayTimedOut = false;
}

/**
 * Context options for a browser from launchHumanBrowser().
 * @param {import('playwright').Browser} browser
 * @param {object} [extra] - merged last (e.g. { viewport })
 * @returns {Promise<object>} options for browser.newContext
 */
export async function humanContextOptions(browser, extra = {}) {
  const options = { locale: 'en-US', timezoneId: await egressTimezone(browser) };
  // Headless Chromium says "HeadlessChrome"; headed reports the right UA natively.
  if (!headedBrowsers.has(browser)) options.userAgent = chromeUserAgent(browser);
  return { ...options, ...extra };
}
