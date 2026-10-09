// Shared helpers for Playwright-driven UI integration tests.

// The ThumbnailCarousel only mounts after the user navigates between POIs
// (Sidebar.jsx gates it on `hasNavigatedPoi`, set true on the first swipe/chevron
// navigation) — opening a POI no longer shows it on first paint. Simulate a
// horizontal swipe on the open sidebar to trigger navigation so the carousel
// renders. Tries "next" first, then "prev" in case the open POI is at the start
// of the navigation list. Returns true once the carousel is present.
export async function showCarouselViaSwipe(page) {
  const swipe = (direction) => page.evaluate((dir) => {
    const el = document.querySelector('.sidebar');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = Math.round(rect.top + Math.min(rect.height / 2, 200));
    const startX = dir === 'next' ? 260 : 110;
    const endX = dir === 'next' ? 110 : 260;
    const midX = Math.round((startX + endX) / 2);
    const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    const send = (type, x, list) => el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: list, targetTouches: list, changedTouches: [mk(x)],
    }));
    send('touchstart', startX, [mk(startX)]);
    send('touchmove', midX, [mk(midX)]);
    send('touchend', endX, []);
  }, direction);

  // Fix: a swipe does nothing until the map has settled and reported which
  // places are in view, so one early swipe was a race; keep trying (PR #737 review)
  for (let attempt = 0; attempt < 8; attempt++) {
    await swipe(attempt % 2 === 0 ? 'next' : 'prev');
    await page.waitForTimeout(500);
    if (await page.locator('.thumbnail-carousel').count() > 0) return true;
  }
  return false;
}

/**
 * Open a POI's sidebar via its bare-path permalink (/<slug>). Clicking a map
 * marker is unreliable: the first marker may be a cluster, or the map may still
 * be fitting bounds when the click lands, so the sidebar never opens. A given
 * slug may not resolve (e.g. POI not in the loaded set), so try up to 15
 * candidates until the sidebar opens.
 * @param {import('playwright').Page} page
 * @param {string} baseUrl - app origin, e.g. http://localhost:8080
 * @param {object} [opts]
 * @param {(poi: object) => boolean} [opts.filter] - narrows the candidate POIs
 * @param {(page: import('playwright').Page) => Promise<boolean>} [opts.accept] - checks the opened sidebar
 * @returns {Promise<object|null>} the opened POI, or null if none resolve
 */
export async function openPoiViaPermalink(page, baseUrl, { filter = () => true, accept = async () => true } = {}) {
  const res = await fetch(`${baseUrl}/api/destinations`);
  // Fix: /api/destinations redirects to /api/pois, which always returns an array (PR #678 review)
  const list = (await res.json()).filter(filter);
  for (const poi of list.slice(0, 15)) {
    // Slug must match frontend/src/App.jsx generateSlug so the permalink resolves.
    const slug = (poi.name || '').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    await page.goto(`${baseUrl}/${slug}`, { waitUntil: 'networkidle' });
    try {
      await page.waitForSelector('.sidebar.open', { timeout: 5000 });
    } catch (err) {
      // Fix: only a selector timeout means this slug missed; surface anything else (PR #678 review)
      if (err.name === 'TimeoutError') continue;
      throw err;
    }
    if (await accept(page)) return poi;
  }
  return null;
}
