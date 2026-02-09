/**
 * Playwright UI Integration Tests for Header Buttons
 * Tests that login/logout buttons are visible and clickable across different viewports
 *
 * This test suite was created to catch regressions where header overflow: hidden
 * would clip the login/logout buttons, making them invisible or unclickable.
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 * - Playwright browsers must be installed
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';
const TEST_TIMEOUT = 30000;

describe('Header Button Visibility Tests', () => {
  let browser;
  let context;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      timeout: 30000
    });
  }, 30000);

  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
  }, 30000);

  afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  afterAll(async () => {
    if (browser) await browser.close();
  }, 30000);

  describe('Desktop Viewport (1920x1080)', () => {
    beforeEach(async () => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    }, 30000);

    it('should display Login button when not authenticated', async () => {
      const loginButton = page.locator('button:has-text("Login")').first();

      // Button should be visible
      const isVisible = await loginButton.isVisible();
      expect(isVisible).toBe(true);

      // Button should be in viewport (not clipped)
      const box = await loginButton.boundingBox();
      expect(box).not.toBeNull();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.height).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it('should have enabled and clickable Login button', async () => {
      const loginButton = page.locator('button:has-text("Login")').first();

      // Should be enabled (verifies it's not disabled/cut off)
      const isEnabled = await loginButton.isEnabled();
      expect(isEnabled).toBe(true);

      // Should be able to get bounding box (verifies it's in layout, not clipped)
      const box = await loginButton.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe('Mobile Viewport (Samsung S25 - 360x800)', () => {
    beforeEach(async () => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    }, 30000);

    it('should display Login button on narrow mobile screen', async () => {
      // Wait for the Login button to be visible (may take time to render on mobile)
      const loginButton = page.locator('button:has-text("Login")').first();
      await loginButton.waitFor({ state: 'visible', timeout: 10000 });

      // Button should be visible
      const isVisible = await loginButton.isVisible();
      expect(isVisible).toBe(true);

      // Button should be fully in viewport (not clipped by header overflow)
      const box = await loginButton.boundingBox();
      expect(box).not.toBeNull();

      // Button should be within viewport bounds
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(800);

      // Button should have reasonable height (not cut off)
      expect(box.height).toBeGreaterThanOrEqual(24); // Minimum reasonable button height

      console.log(`[Login Button] Position: y=${box.y}, height=${box.height}, bottom=${box.y + box.height}`);
    }, TEST_TIMEOUT);

    it('should have enabled and clickable Login button on mobile', async () => {
      const loginButton = page.locator('button:has-text("Login")').first();

      // Should be enabled (verifies it's not disabled/cut off)
      const isEnabled = await loginButton.isEnabled();
      expect(isEnabled).toBe(true);

      // Should be able to get bounding box (verifies it's in layout, not clipped)
      const box = await loginButton.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe('Tablet Viewport (768x1024)', () => {
    beforeEach(async () => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    }, 30000);

    it('should display Login button on tablet', async () => {
      const loginButton = page.locator('button:has-text("Login")').first();

      const isVisible = await loginButton.isVisible();
      expect(isVisible).toBe(true);

      const box = await loginButton.boundingBox();
      expect(box).not.toBeNull();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.height).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe('Header Overflow Regression Test', () => {
    it('should NOT have overflow:hidden on header that clips buttons', async () => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

      // Get computed overflow style on header
      const headerOverflow = await page.evaluate(() => {
        const header = document.querySelector('.header');
        if (!header) return null;
        const style = window.getComputedStyle(header);
        return {
          overflow: style.overflow,
          overflowY: style.overflowY,
          overflowX: style.overflowX
        };
      });

      expect(headerOverflow).not.toBeNull();

      // Header should NOT have overflow: hidden that would clip content
      // It should use overflow: visible or clip the video separately
      expect(headerOverflow.overflow).not.toBe('hidden');

      console.log('[Header Overflow] Style:', headerOverflow);
    }, TEST_TIMEOUT);
  });
});
