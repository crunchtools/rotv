export async function simulateSwipeLeft(page) {
  const box = await page.locator('.sidebar.open').boundingBox();
  if (!box) throw new Error('Sidebar is not open or visible, cannot simulate swipe');
  const startX = box.x + box.width * 0.75;
  const startY = box.y + box.height * 0.5;
  const endX = startX - 150; // 150px left exceeds minSwipeDistance=50

  await page.evaluate(({ startX, startY, endX }) => {
    const sidebar = document.querySelector('.sidebar.open');
    if (!sidebar) return;
    const mkTouch = (x, y) => new Touch({
      identifier: 1, target: sidebar,
      clientX: x, clientY: y, screenX: x, screenY: y, pageX: x, pageY: y,
      radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
    });
    const t0 = mkTouch(startX, startY);
    sidebar.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true,
      touches: [t0], targetTouches: [t0], changedTouches: [t0],
    }));
    const t1 = mkTouch(endX, startY);
    sidebar.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true, cancelable: true,
      touches: [t1], targetTouches: [t1], changedTouches: [t1],
    }));
    sidebar.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true, cancelable: true,
      touches: [], targetTouches: [], changedTouches: [t1],
    }));
  }, { startX, startY, endX });
}
