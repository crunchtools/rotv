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

  await swipe('next');
  await page.waitForTimeout(400);
  if (await page.locator('.thumbnail-carousel').count() === 0) {
    await swipe('prev');
    await page.waitForTimeout(400);
  }
  return (await page.locator('.thumbnail-carousel').count()) > 0;
}

// Open a POI's sidebar via its bare-path permalink (/<slug>). Clicking a map
// marker is unreliable: the first marker may be a cluster, or the map may still
// be fitting bounds when the click lands, so the sidebar never opens. A given
// slug may not resolve (e.g. POI not in the loaded set), so try candidates until
// the sidebar opens. `filter` narrows the candidate POIs; `accept` checks the
// opened sidebar. Returns the POI, or null if none resolve.
export async function openPoiViaPermalink(page, baseUrl, { filter = () => true, accept = async () => true } = {}) {
  const res = await fetch(`${baseUrl}/api/destinations`);
  const body = await res.json();
  const list = (Array.isArray(body) ? body : (body.destinations || body.pois || [])).filter(filter);
  for (const poi of list.slice(0, 15)) {
    // Slug must match frontend/src/App.jsx generateSlug so the permalink resolves.
    const slug = (poi.name || '').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    await page.goto(`${baseUrl}/${slug}`, { waitUntil: 'networkidle' });
    try {
      await page.waitForSelector('.sidebar.open', { timeout: 5000 });
    } catch { continue; }
    if (await accept(page)) return poi;
  }
  return null;
}
