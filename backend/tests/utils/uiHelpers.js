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
