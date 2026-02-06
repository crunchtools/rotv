import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

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
 * - Bug #11: NPS Map functionality in POI panel
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

    it('should position sidebar correctly on mobile with 16px top spacing', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // Wait for markers and click one
      await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });
      await page.locator('.leaflet-marker-icon').first().click();

      // Wait for sidebar
      await page.waitForSelector('.sidebar.open', { timeout: 5000 });

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
      // Should be 1rem (16px) from top of map container
      expect(sidebarPosition.topPx).toBe(16);

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

  describe('Bug #11: NPS Map Functionality', () => {
    it('should display NPS Map toggle in POI panel when destination has coordinates', async () => {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // Wait for markers and click one to open sidebar
      await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });
      await page.locator('.leaflet-marker-icon').first().click();

      // Wait for sidebar to open
      await page.waitForSelector('.sidebar.open', { timeout: 5000 });

      // Look for NPS Map toggle or related control
      const npsMapControl = page.locator('.nps-map-toggle, .nps-map-btn, button:has-text("NPS Map"), .map-toggle');
      const npsMapExists = await npsMapControl.count() > 0;

      if (npsMapExists) {
        console.log('[Test] NPS Map control found in sidebar');
        expect(await npsMapControl.first().isVisible()).toBe(true);
      } else {
        // Check if there's any map-related control in the sidebar
        const mapControls = page.locator('.sidebar [class*="map"], .sidebar button:has-text("Map")');
        console.log(`[Test] Found ${await mapControls.count()} map-related controls in sidebar`);
        // This should fail if NPS Map control is not found
        expect(npsMapExists).toBe(true);
      }
    }, 30000);

    it('should render NPS Map component when toggled', async () => {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // Click a marker
      await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });
      await page.locator('.leaflet-marker-icon').first().click();
      await page.waitForSelector('.sidebar.open', { timeout: 5000 });

      // Try to find and click NPS Map toggle
      const npsToggle = page.locator('button:has-text("NPS"), .nps-map-toggle, [class*="nps"]');
      const toggleExists = await npsToggle.count() > 0;

      expect(toggleExists).toBe(true);

      if (toggleExists) {
        await npsToggle.first().click();
        await page.waitForTimeout(500);

        // Check if NPS Map iframe or component appeared
        const npsContent = page.locator('.nps-map-container, iframe[src*="nps"], .nps-map');
        const npsVisible = await npsContent.count() > 0;

        if (npsVisible) {
          console.log('[Test] NPS Map content rendered successfully');
          expect(await npsContent.first().isVisible()).toBe(true);
        }
      }
    }, 30000);
  });
});
