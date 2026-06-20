/**
 * Shared Playwright test helper utilities.
 */

/**
 * Simulate a left swipe on the open sidebar to trigger POI navigation.
 * The sidebar only renders ThumbnailCarousel after hasNavigatedPoi becomes true,
 * which requires a successful swipe gesture that exceeds minSwipeDistance (50px).
 *
 * @param {import('playwright').Page} page
 */
export async function simulateSwipeLeft(page) {
  const box = await page.locator('.sidebar.open').boundingBox();
  if (!box) {
    throw new Error('Sidebar is not open or visible, cannot simulate swipe');
  }

  await page.evaluate((b) => {
    const sidebar = document.querySelector('.sidebar.open');
    if (!sidebar) return;

    const centerX = b.x + b.width / 2;
    const centerY = b.y + b.height / 2;
    const swipeDistance = 100; // exceeds minSwipeDistance of 50

    const makeTouch = (x, y) => new Touch({
      identifier: 1,
      target: sidebar,
      clientX: x,
      clientY: y,
      radiusX: 1,
      radiusY: 1,
      rotationAngle: 0,
      force: 1,
    });

    const dispatch = (type, x, y) => {
      const touch = makeTouch(x, y);
      sidebar.dispatchEvent(new TouchEvent(type, {
        cancelable: true,
        bubbles: true,
        changedTouches: [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        touches: type === 'touchend' ? [] : [touch],
      }));
    };

    dispatch('touchstart', centerX, centerY);
    dispatch('touchmove', centerX - swipeDistance / 2, centerY);
    dispatch('touchend', centerX - swipeDistance, centerY);
  }, box);
}
