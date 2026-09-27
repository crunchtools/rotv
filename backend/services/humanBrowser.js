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
export const FALLBACK_TIMEZONE = 'America/New_York';

let timezoneCache = null; // { timezone, at }
const headedBrowsers = new WeakSet();

/**
 * @param {string|undefined} display - e.g. ":0" or ":1.0"
 * @returns {boolean} true when that local X display's socket exists
 */
export function hasDisplay(display = process.env.DISPLAY) {
  const match = /^:(\d+)(\.\d+)?$/.exec(display || '');
  return Boolean(match) && existsSync(`/tmp/.X11-unix/X${match[1]}`);
}

/**
 * @param {unknown} tz
 * @returns {boolean} true for an IANA zone this runtime (and so Chromium) accepts
 */
export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch the fingerprint-consistent browser: headed when a display exists,
 * proxied through PLAYWRIGHT_PROXY when set.
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchHumanBrowser() {
  const headed = hasDisplay();
  if (!headed) logger.warn('No X display; launching headless (expected only in dev/CI)');
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

/** Test hook: forget the cached egress timezone. */
export function resetTimezoneCache() {
  timezoneCache = null;
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
