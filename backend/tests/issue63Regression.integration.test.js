import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

// Navigate to the first resolvable POI via URL slug. More reliable than clicking
// a marker on mobile where the first .leaflet-marker-icon may be a cluster.
async function openFirstPoi(page, baseUrl) {
  const res = await fetch(`${baseUrl}/api/destinations`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.destinations || body.pois || []);
  for (const poi of list.slice(0, 15)) {
    const slug = (poi.name || '').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) continue;
    await page.goto(`${baseUrl}/${slug}`, { waitUntil: 'networkidle' });
    try {
      await page.waitForSelector('.sidebar.open', { timeout: 5000 });
      return poi;
    } catch { continue; }
  }
  return null;
}

// Simulate a horizontal swipe on the sidebar to trigger hasNavigatedPoi=true,
// which is required for the ThumbnailCarousel to render (since commit 1bd4f00).
async function simulateSwipe(page) {
  await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const rect = sidebar.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.8;
    const endX = rect.left + rect.width * 0.1;
    const y = rect.top + rect.height * 0.5;
    const mkTouch = (x) => new Touch({ identifier: 1, target: sidebar, clientX: x, clientY: y, pageX: x, pageY: y });
    const ts = mkTouch(startX);
    sidebar.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [ts], changedTouches: [ts] }));
    const te = mkTouch(endX);
    sidebar.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [te] }));
  });
  await page.waitForTimeout(400);
}

/**
 * Issue #63 Regression Tests
 *
 * These tests ONLY include bugs that were verified to:
 * - FAIL on the production container (before fixes)
 * - PASS on the new container (with fixes)
 *
 * Tests that pass on both containers are useless and have been removed.
 *
 * Validated bugs:
 * - Bug #6: Mobile responsive layout (CSS variables, positioning)
 */

describe('Issue #63 Regression Tests', () => {
  let browser;
  let page;
  const baseUrl = 'http://localhost:8080';

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    // Dismiss tour prompt so the overlay stops intercepting pointer events
    await page.addInitScript(() => {
      localStorage.setItem('rotv-tour-seen', 'true');
    });
  });

  afterAll(async () => {
    if (page) await page.close();
    if (browser) await browser.close();
  });

  describe('Bug #6: Mobile Responsive Layout', () => {
    it('should position map controls correctly below header on mobile', async () => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // Wait for controls to render
      await page.waitForSelector('.zoom-locate-control', { timeout: 10000 });
      await page.waitForSelector('.map-poi-count', { timeout: 10000 });

      // Verify GPS controls are visible and properly positioned
      const controlPosition = await page.evaluate(() => {
        const leafletControl = document.querySelector('.leaflet-top');
        const header = document.querySelector('.header');
        if (!leafletControl || !header) return null;

        const controlRect = leafletControl.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();

        return {
          controlTop: controlRect.top,
          headerBottom: headerRect.bottom,
          isVisible: controlRect.top >= 0,
          isNotOverlapping: controlRect.top >= headerRect.bottom - 10
        };
      });

      expect(controlPosition).not.toBeNull();
      expect(controlPosition.isVisible).toBe(true);
      expect(controlPosition.isNotOverlapping).toBe(true);

      // Reset viewport
      await page.setViewportSize({ width: 1280, height: 720 });
    }, 30000);

    it('should use CSS variables for responsive header height', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // Check that CSS variables are being used
      const cssVarValue = await page.evaluate(() => {
        const root = document.documentElement;
        return getComputedStyle(root).getPropertyValue('--header-height').trim();
      });

      // Should have a header-height CSS variable set
      expect(cssVarValue).toBeTruthy();
      console.log(`[Test] Mobile --header-height: ${cssVarValue}`);

      // Desktop should have different value
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.waitForTimeout(300);

      const desktopCssVar = await page.evaluate(() => {
        const root = document.documentElement;
        return getComputedStyle(root).getPropertyValue('--header-height').trim();
      });

      console.log(`[Test] Desktop --header-height: ${desktopCssVar}`);
      expect(desktopCssVar).toBeTruthy();
    }, 30000);

    it('should position sidebar flush with top on mobile', async () => {
      await page.setViewportSize({ width: 375, height: 667 });

      // Navigate to a POI via URL slug — more reliable than clicking a marker,
      // which may hit a cluster icon that expands instead of opening the sidebar.
      const poi = await openFirstPoi(page, baseUrl);
      expect(poi).not.toBeNull();

      // Wait for transition to complete (0.3s CSS transition)
      await page.waitForTimeout(500);

      // Check sidebar positioning
      const sidebarPosition = await page.evaluate(() => {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return null;

        const style = getComputedStyle(sidebar);
        return {
          top: style.top,
          topPx: parseInt(style.top, 10)
        };
      });

      expect(sidebarPosition).not.toBeNull();
      // Should be flush with top (0px) - carousel fills the green header area
      expect(sidebarPosition.topPx).toBe(0);

      await page.setViewportSize({ width: 1280, height: 720 });
    }, 30000);

    it('should have 16px bottom padding on thumbnail carousel for spacing', async () => {
      await page.setViewportSize({ width: 375, height: 667 });

      // Navigate via URL slug for reliable sidebar open, then swipe to trigger
      // hasNavigatedPoi=true so ThumbnailCarousel renders (required since 1bd4f00).
      const poi = await openFirstPoi(page, baseUrl);
      expect(poi).not.toBeNull();
      await simulateSwipe(page);

      // Wait for carousel
      await page.waitForSelector('.thumbnail-carousel', { timeout: 5000 });

      // Check carousel bottom padding - this provides the 16px spacing between carousel and content
      const carouselPadding = await page.evaluate(() => {
        const carousel = document.querySelector('.thumbnail-carousel');
        if (!carousel) return null;

        const style = getComputedStyle(carousel);
        return {
          paddingBottom: style.paddingBottom,
          paddingBottomPx: parseInt(style.paddingBottom, 10)
        };
      });

      expect(carouselPadding).not.toBeNull();
      // Should have 1rem (16px) bottom padding for spacing between carousel and sidebar content
      expect(carouselPadding.paddingBottomPx).toBe(16);
      console.log(`[Test] Carousel bottom padding: ${carouselPadding.paddingBottom}`);

      await page.setViewportSize({ width: 1280, height: 720 });
    }, 30000);

    it('should position legend correctly with 16px margins on mobile', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // Open legend by clicking Results badge
      const resultsBadge = page.locator('.map-poi-count');
      await resultsBadge.click();
      await page.waitForTimeout(500);

      // Wait for legend to expand
      await page.waitForSelector('.legend.legend-expanded', { timeout: 5000 });

      // Check legend positioning
      const legendPosition = await page.evaluate(() => {
        const legend = document.querySelector('.legend.legend-expanded');
        if (!legend) return null;

        const style = getComputedStyle(legend);
        return {
          left: style.left,
          right: style.right,
          leftPx: parseInt(style.left, 10),
          rightPx: parseInt(style.right, 10)
        };
      });

      expect(legendPosition).not.toBeNull();
      // Should have 1rem (16px) margins on sides
      expect(legendPosition.leftPx).toBe(16);
      expect(legendPosition.rightPx).toBe(16);

      await page.setViewportSize({ width: 1280, height: 720 });
    }, 30000);
  });

});
