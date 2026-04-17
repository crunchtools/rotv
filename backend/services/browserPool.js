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
 */

import { chromium } from 'playwright';

let sharedBrowser = null;
let browserRefCount = 0;
let browserCloseTimer = null;

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
 * Acquire the shared browser, launching it if not running.
 * Every call must be paired with releaseBrowser().
 * @returns {Promise<import('playwright').Browser>}
 */
export async function acquireBrowser() {
  if (browserCloseTimer) {
    clearTimeout(browserCloseTimer);
    browserCloseTimer = null;
  }
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    const opts = { ...LAUNCH_OPTIONS };
    if (process.env.PLAYWRIGHT_PROXY) {
      opts.proxy = { server: process.env.PLAYWRIGHT_PROXY };
    }
    sharedBrowser = await chromium.launch(opts);
  }
  browserRefCount++;
  return sharedBrowser;
}

/**
 * Release a browser reference acquired with acquireBrowser().
 * Schedules the browser to close after 30 s of full idle.
 */
export function releaseBrowser() {
  browserRefCount--;
  if (browserRefCount <= 0) {
    browserRefCount = 0;
    browserCloseTimer = setTimeout(async () => {
      if (browserRefCount === 0 && sharedBrowser) {
        await sharedBrowser.close().catch(() => {});
        sharedBrowser = null;
      }
    }, 30000);
  }
}
