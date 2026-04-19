/**
 * Shared Chromium browser pool.
 *
 * One long-lived Chromium process is reused across all render calls in both
 * jsRenderer and contentExtractor. Each render gets its own BrowserContext
 * for full cookie/session isolation — only the expensive OS-level browser
 * process is shared.
 *
 * Memory profile:
 *   - 1 shared Chromium process  ≈ 200-300 MB base
 *   - Each concurrent context    ≈ 50-100 MB
 *   vs. previous model:
 *   - Each render spawned its own Chromium ≈ 300-400 MB
 *
 * With MAX_CONCURRENCY=10 the old model peaked at ~4 GB; the new model
 * peaks at ~1.2 GB under the same load.
 *
 * Idle behaviour: the browser closes 30 s after the last context is
 * released, freeing memory between collection runs.
 *
 * Watchdog: 90 s per-acquisition timeout force-kills the browser if
 * releaseBrowser() is never called (above jsRenderer's 60 s hard timeout).
 */

import { chromium } from 'playwright';

let sharedBrowser = null;
let browserRefCount = 0;
let browserCloseTimer = null;
let launchPromise = null; // Prevents concurrent launches (race condition fix)

const WATCHDOG_TIMEOUT_MS = 90_000;
const watchdogTimers = new Map(); // acquisitionId → timeoutId
let nextAcquisitionId = 0;

const LAUNCH_OPTIONS = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled'
  ]
};

/**
 * Force-kill the shared browser, clearing all watchdog timers and resetting state.
 * Used by the watchdog and the circuit breaker health check.
 */
export async function forceKill(reason = 'unknown') {
  console.error(`[BrowserPool] Force-kill: ${reason} (refCount was ${browserRefCount})`);
  const browser = sharedBrowser;
  sharedBrowser = null;
  browserRefCount = 0;
  launchPromise = null;
  if (browserCloseTimer) {
    clearTimeout(browserCloseTimer);
    browserCloseTimer = null;
  }
  for (const [, t] of watchdogTimers) clearTimeout(t);
  watchdogTimers.clear();
  if (browser) await browser.close().catch(() => {});
}

/**
 * Health check: render a trivial data URI to test browser responsiveness.
 * Returns true if the browser responds within timeoutMs, false if overloaded.
 * If no browser is running, returns true (a fresh launch will be healthy).
 */
export async function healthCheck(timeoutMs = 1000) {
  if (!sharedBrowser || !sharedBrowser.isConnected()) return true;
  let ctx;
  try {
    ctx = await sharedBrowser.newContext();
    const page = await ctx.newPage();
    await page.goto('data:text/html,<h1>ok</h1>', { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

/**
 * @returns {Promise<{browser: import('playwright').Browser, acquisitionId: number}>}
 */
export async function acquireBrowser() {
  if (browserCloseTimer) {
    clearTimeout(browserCloseTimer);
    browserCloseTimer = null;
  }
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    if (!launchPromise) {
      launchPromise = (async () => {
        const opts = { ...LAUNCH_OPTIONS };
        if (process.env.PLAYWRIGHT_PROXY) {
          opts.proxy = { server: process.env.PLAYWRIGHT_PROXY };
        }
        sharedBrowser = await chromium.launch(opts);
      })().finally(() => { launchPromise = null; });
    }
    await launchPromise;
  }
  browserRefCount++;

  const id = nextAcquisitionId++;
  const timer = setTimeout(async () => {
    await forceKill(`Watchdog: acquisition ${id} held browser for >${WATCHDOG_TIMEOUT_MS / 1000}s without release`);
  }, WATCHDOG_TIMEOUT_MS);
  watchdogTimers.set(id, timer);

  return { browser: sharedBrowser, acquisitionId: id };
}

/**
 * Release a browser reference acquired with acquireBrowser().
 * Schedules the browser to close after 30 s of full idle.
 * @param {number} [acquisitionId] - The id returned by acquireBrowser(). Clears the watchdog.
 */
export function releaseBrowser(acquisitionId) {
  if (acquisitionId != null && watchdogTimers.has(acquisitionId)) {
    clearTimeout(watchdogTimers.get(acquisitionId));
    watchdogTimers.delete(acquisitionId);
  }
  browserRefCount--;
  if (browserRefCount < 0) {
    console.error('[BrowserPool] BUG: releaseBrowser() called more times than acquireBrowser() — resetting to 0');
    browserRefCount = 0;
  }
  if (browserRefCount === 0) {
    browserCloseTimer = setTimeout(async () => {
      if (browserRefCount === 0 && sharedBrowser) {
        await sharedBrowser.close().catch(() => {});
        sharedBrowser = null;
      }
    }, 30000);
  }
}
