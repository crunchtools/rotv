/**
 * Shared Chromium browser pool.
 *
 * One long-lived Chromium process per egress is reused across all render calls
 * in both jsRenderer and contentExtractor. Each render gets its own
 * BrowserContext for full cookie/session isolation — only the expensive
 * OS-level browser process is shared.
 *
 * Memory profile:
 *   - Each shared Chromium process ≈ 200-300 MB base; up to two run (vpn and
 *     direct), the second only while a crawl renders a direct or IPRoyal site
 *   - Each concurrent context      ≈ 50-100 MB, whichever browser holds it
 *   vs. previous model:
 *   - Each render spawned its own Chromium ≈ 300-400 MB
 *
 * With MAX_CONCURRENCY=10 the old model peaked at ~4 GB; the pool peaks at
 * ~1.2 GB with one browser and ~1.5 GB with both under the same load.
 *
 * Idle behaviour: each browser closes 30 s after its last context is
 * released, freeing memory between collection runs.
 *
 * Egress (see egressRoutes.js): the 'vpn' browser launches through
 * PLAYWRIGHT_PROXY (ExpressVPN); the 'direct' browser goes through
 * directEgressProxy.js, which dials only public addresses from lotor's own IP,
 * and also carries IPRoyal renders, whose proxy is set per context. Chromium can't take
 * a context off its browser's proxy, so a route needs its own browser for
 * failover to switch mid-crawl. The 'direct' browser only launches when a
 * site needs it.
 *
 * Watchdog: 90 s per-acquisition timeout force-kills that browser if
 * releaseBrowser() is never called (above jsRenderer's 60 s hard timeout).
 */

import { chromium } from 'playwright';
import { createLogger } from '../utils/logger.js';
import { directEgressProxyUrl } from './directEgressProxy.js';

const logger = createLogger('BrowserPool');

const WATCHDOG_TIMEOUT_MS = 90_000;
const IDLE_CLOSE_MS = 30_000;
const KILLED_GRACE_MS = 2 * WATCHDOG_TIMEOUT_MS; // how long a killed acquisition's late release is ignored
const slots = new Map(); // key → { browser, refCount, closeTimer, launchPromise }
const watchdogTimers = new Map(); // acquisitionId → { timer, key }
let nextAcquisitionId = 0;

// Exported for callers that launch their own browser (humanBrowser.js).
export const LAUNCH_OPTIONS = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    // --disable-gpu alone does not stop headless Chrome from spawning a GPU
    // process for SwiftShader software GL. That process segfaults on some
    // scrape targets (~12 coredumps/hr on lotor; spiked to 81/hr and helped
    // trigger an outage on lotor). This keeps it off the SwiftShader path.
    // Deliberately NOT using --in-process-gpu: a separate GPU process crash is
    // recoverable (Chrome respawns it), but in-process it would kill the whole
    // browser and fail the scrape.
    '--disable-software-rasterizer',
    '--disable-blink-features=AutomationControlled'
  ]
};

/**
 * Desktop-Linux Chrome UA for the Chromium actually running, so the UA's
 * version agrees with the client hints (Sec-CH-UA) the browser sends itself.
 * Uses the reduced form Chrome ships (MAJOR.0.0.0).
 * @param {import('playwright').Browser} browser
 * @returns {string}
 */
export function chromeUserAgent(browser) {
  const major = String(browser.version()).split('.')[0];
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function slotFor(key) {
  if (!slots.has(key)) slots.set(key, { browser: null, refCount: 0, closeTimer: null, launchPromise: null });
  return slots.get(key);
}

async function killSlot(key, slot) {
  const browser = slot.browser;
  slot.browser = null;
  slot.refCount = 0;
  slot.launchPromise = null;
  if (slot.closeTimer) {
    clearTimeout(slot.closeTimer);
    slot.closeTimer = null;
  }
  // Keep the ids as killed: a late releaseBrowser() for one must not count
  // against the relaunched browser (or another key's).
  // Dropped after a grace period so acquisitions that never release don't pile up.
  for (const [id, w] of watchdogTimers) {
    if (w.key === key && !w.killed) {
      clearTimeout(w.timer);
      w.killed = true;
      setTimeout(() => watchdogTimers.delete(id), KILLED_GRACE_MS).unref?.();
    }
  }
  if (browser) await browser.close().catch(err => logger.warn(`Force-kill: ${key} browser close failed: ${err.message}`));
}

/**
 * Force-kill shared browsers, clearing their watchdog timers and resetting state.
 * Used by the watchdog and the circuit breaker health check.
 * @param {string} [reason]
 * @param {string} [key] - One browser ('vpn' or 'direct'); all of them when omitted
 */
export async function forceKill(reason = 'unknown', key) {
  const keys = key ? [key] : [...slots.keys()];
  for (const k of keys) {
    const slot = slots.get(k);
    if (!slot) continue;
    logger.error(`Force-kill ${k}: ${reason} (refCount was ${slot.refCount})`);
    await killSlot(k, slot);
  }
}

/**
 * Health check: render a trivial data URI to test browser responsiveness.
 * Returns true if the browser responds within timeoutMs, false if overloaded.
 * If no browser is running, returns true (a fresh launch will be healthy).
 * @param {number} [timeoutMs]
 * @param {string} [key] - Which browser; the ExpressVPN one by default
 */
export async function healthCheck(timeoutMs = 1000, key = 'vpn') {
  const browser = slots.get(key)?.browser;
  if (!browser || !browser.isConnected()) return true;

  const check = (async () => {
    let ctx;
    try {
      ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto('data:text/html,<h1>ok</h1>', { timeout: timeoutMs });
      return true;
    } catch (err) {
      logger.warn(`Health check failed: ${err.message}`);
      return false;
    } finally {
      if (ctx) await ctx.close().catch(err => logger.debug(`Health check: context close failed: ${err.message}`));
    }
  })();

  const timeout = new Promise(resolve => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([check, timeout]);
}

/**
 * @param {'vpn'|'direct'} [key] - 'vpn' egresses through PLAYWRIGHT_PROXY, 'direct' from lotor's IP (public addresses only)
 * @returns {Promise<{browser: import('playwright').Browser, acquisitionId: number}>}
 */
export async function acquireBrowser(key = 'vpn') {
  const slot = slotFor(key);
  if (slot.closeTimer) {
    clearTimeout(slot.closeTimer);
    slot.closeTimer = null;
  }
  if (!slot.browser || !slot.browser.isConnected()) {
    if (!slot.launchPromise) {
      slot.launchPromise = (async () => {
        const opts = { ...LAUNCH_OPTIONS };
        // '<-loopback>' drops Chromium's built-in proxy bypass for localhost, so a
        // crawled link to 127.0.0.1 goes to the proxy instead of lotor's loopback.
        if (key === 'direct') {
          opts.proxy = { server: await directEgressProxyUrl(), bypass: '<-loopback>' };
        } else if (process.env.PLAYWRIGHT_PROXY) {
          opts.proxy = { server: process.env.PLAYWRIGHT_PROXY, bypass: '<-loopback>' };
        }
        slot.browser = await chromium.launch(opts);
      })().finally(() => { slot.launchPromise = null; });
    }
    await slot.launchPromise;
  }
  slot.refCount++;

  const id = nextAcquisitionId++;
  const timer = setTimeout(async () => {
    await forceKill(`Watchdog: acquisition ${id} held browser for >${WATCHDOG_TIMEOUT_MS / 1000}s without release`, key);
  }, WATCHDOG_TIMEOUT_MS);
  watchdogTimers.set(id, { timer, key });

  return { browser: slot.browser, acquisitionId: id };
}

/**
 * Release a browser reference acquired with acquireBrowser().
 * Schedules that browser to close after 30 s of full idle.
 * @param {number} [acquisitionId] - The id returned by acquireBrowser(). Clears the watchdog.
 * @param {'vpn'|'direct'} [key] - Only needed without an acquisitionId; defaults to 'vpn'
 */
export function releaseBrowser(acquisitionId, key = 'vpn') {
  const watchdog = acquisitionId != null ? watchdogTimers.get(acquisitionId) : null;
  if (watchdog) {
    clearTimeout(watchdog.timer);
    watchdogTimers.delete(acquisitionId);
    if (watchdog.killed) return; // its browser was force-killed and its count reset
    key = watchdog.key;
  }
  const slot = slotFor(key);
  slot.refCount--;
  if (slot.refCount < 0) {
    logger.error('BUG: releaseBrowser() called more times than acquireBrowser() — resetting to 0');
    slot.refCount = 0;
  }
  if (slot.refCount === 0) {
    slot.closeTimer = setTimeout(async () => {
      if (slot.refCount === 0 && slot.browser) {
        // Clear the slot first, so an acquire during the close launches a new browser.
        const idle = slot.browser;
        slot.browser = null;
        await idle.close().catch(err => logger.warn(`Idle close failed: ${err.message}`));
      }
    }, IDLE_CLOSE_MS);
  }
}
