export async function simulateSwipeLeft(page) {
  const box = await page.locator('.sidebar.open').boundingBox();
  if (!box) {
    throw new Error('Sidebar is not open or visible, cannot simulate swipe');
  }
  const startX = box.x + box.width * 0.75;
  const startY = box.y + box.height * 0.5;
  const endX = box.x + box.width * 0.25;
  await page.evaluate(([sx, sy, ex]) => {
    const el = document.querySelector('.sidebar.open');
    const mkTouch = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true,
      touches: [mkTouch(sx, sy)], changedTouches: [mkTouch(sx, sy)]
    }));
    el.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true, cancelable: true,
      touches: [mkTouch(ex, sy)], changedTouches: [mkTouch(ex, sy)]
    }));
    el.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true, cancelable: true,
      touches: [], changedTouches: [mkTouch(ex, sy)]
    }));
  }, [startX, startY, endX]);
}
