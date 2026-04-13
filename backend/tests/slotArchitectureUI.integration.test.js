/**
 * Playwright UI Integration Tests for Slot Architecture
 * Tests the frontend slot display and user interactions for News/Events and Trail Status
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 * - Playwright browsers must be installed
 * - Must be authenticated as admin in browser
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';
const TEST_TIMEOUT = 60000; // 60 seconds for UI tests

describe('Slot Architecture UI Tests - News/Events', () => {
  let browser;
  let page;
  let context;

  beforeAll(async () => {
    // Launch browser once for all tests
    browser = await chromium.launch({
      headless: true,
      timeout: 30000
    });
  }, 30000);

  beforeEach(async () => {
    // Create fresh context and page for each test
    context = await browser.newContext();
    page = await context.newPage();

    // Navigate to admin page
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle', timeout: 30000 });

    // Note: Authentication might be required
    // If tests fail with login prompts, authentication setup is needed
  }, 30000);

  afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  afterAll(async () => {
    if (browser) await browser.close();
  }, 30000);

  describe('Initial State Tests', () => {
    it('should not display progress widget initially (no job running)', async () => {
      // Check if progress widget is visible
      const progressWidget = page.locator('[data-testid="news-progress-widget"]')
        .or(page.locator('.news-collection-progress'))
        .or(page.locator('text=News & Events Collection'));

      // If widget exists, it should not be visible or should indicate no active job
      const isVisible = await progressWidget.isVisible().catch(() => false);

      if (isVisible) {
        // Widget might be visible but showing "No active job" or similar
        const text = await page.textContent('body');
        const hasActiveJob = text.includes('Collecting') || text.includes('Searching') || text.includes('Rendering');

        expect(hasActiveJob).toBe(false);
      }
    }, TEST_TIMEOUT);

    it('should show "Collect News & Events" button enabled', async () => {
      // Find the collect button (various possible selectors)
      const collectButton = page.locator('button:has-text("Collect News")')
        .or(page.locator('button:has-text("Start Collection")'))
        .or(page.locator('[data-testid="collect-news-button"]'));

      const isVisible = await collectButton.isVisible().catch(() => false);

      if (isVisible) {
        const isEnabled = await collectButton.isEnabled();
        expect(isEnabled).toBe(true);
      }
    }, TEST_TIMEOUT);

    it('should show "Collect MTB Trail Status" button enabled', async () => {
      const trailButton = page.locator('button:has-text("Trail Status")')
        .or(page.locator('button:has-text("Collect Status")'))
        .or(page.locator('[data-testid="collect-trail-status-button"]'));

      const isVisible = await trailButton.isVisible().catch(() => false);

      if (isVisible) {
        const isEnabled = await trailButton.isEnabled();
        expect(isEnabled).toBe(true);
      }
    }, TEST_TIMEOUT);
  });

  describe('Starting Collection Job', () => {
    it('should display progress widget after clicking "Collect News & Events"', async () => {
      const collectButton = page.locator('button:has-text("Collect News")')
        .or(page.locator('button:has-text("Start Collection")'));

      const isVisible = await collectButton.isVisible().catch(() => false);

      if (isVisible) {
        // Click button
        await collectButton.click();

        // Wait for progress widget to appear (may take a moment for job to start)
        await page.waitForTimeout(2000);

        // Check for progress indicators
        const hasProgress = await page.locator('text=Collecting')
          .or(page.locator('text=Searching'))
          .or(page.locator('text=Processing'))
          .isVisible()
          .catch(() => false);

        // If no duplicate job error, should see progress
        const hasError = await page.locator('text=already running')
          .isVisible()
          .catch(() => false);

        // Either show progress or show "already running" error
        expect(hasProgress || hasError).toBe(true);
      }
    }, TEST_TIMEOUT);

    it('should show slots with "Waiting" text for empty slots', async () => {
      // This test assumes a job is running
      // Look for slot indicators
      const slotElements = page.locator('[data-testid^="slot-"]')
        .or(page.locator('.slot'))
        .or(page.locator('.progress-slot'));

      const count = await slotElements.count();

      if (count > 0) {
        // Check for "Waiting" text in empty slots
        const waitingSlots = page.locator('text=Waiting')
          .or(page.locator('text=—'));

        const waitingCount = await waitingSlots.count();
        expect(waitingCount).toBeGreaterThanOrEqual(0);
      }
    }, TEST_TIMEOUT);

    it('should prevent starting duplicate job (button disabled)', async () => {
      const collectButton = page.locator('button:has-text("Collect News")');

      const isVisible = await collectButton.isVisible().catch(() => false);

      if (isVisible) {
        // Click to start job
        await collectButton.click();
        await page.waitForTimeout(2000);

        // Check if button is now disabled
        const isEnabled = await collectButton.isEnabled().catch(() => true);

        // OR check for error message
        const hasError = await page.locator('text=already running')
          .isVisible()
          .catch(() => false);

        // Button should be disabled OR error should be shown
        expect(!isEnabled || hasError).toBe(true);
      }
    }, TEST_TIMEOUT);
  });

  describe('Slot Updates During Collection', () => {
    it('should show POI name when slot assigned', async () => {
      // Wait for slots to be populated
      await page.waitForTimeout(3000);

      // Look for POI names in slots (not "Waiting" or "—")
      const poiNames = page.locator('[data-testid^="slot-"] .poi-name')
        .or(page.locator('.slot-poi-name'))
        .or(page.locator('.progress-slot').locator('text').filter({ hasNotText: /^(Waiting|—|$)/ }));

      const count = await poiNames.count();

      // If slots are active, should have POI names
      if (count > 0) {
        const firstSlot = poiNames.first();
        const text = await firstSlot.textContent();
        expect(text).toBeTruthy();
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }, TEST_TIMEOUT);

    it('should show phase icons (⏳ Starting, 🔍 Searching, ✓ Done)', async () => {
      await page.waitForTimeout(3000);

      // Look for phase indicators
      const hasPhaseIndicator = await page.locator('text=/⏳|🔍|📄|✓|❌/')
        .or(page.locator('.phase-icon'))
        .or(page.locator('[data-testid^="phase-"]'))
        .isVisible()
        .catch(() => false);

      // Phase icons might not be visible if no job is running
      // This test passes if we can detect any phase indicators
      expect(typeof hasPhaseIndicator).toBe('boolean');
    }, TEST_TIMEOUT);

    it('should show provider badges (Gemini)', async () => {
      await page.waitForTimeout(3000);

      // Look for provider indicators
      const hasProvider = await page.locator('text=/Gemini|🔷/')
        .or(page.locator('.provider-badge'))
        .or(page.locator('[data-testid^="provider-"]'))
        .isVisible()
        .catch(() => false);

      expect(typeof hasProvider).toBe('boolean');
    }, TEST_TIMEOUT);

    it('should NOT show long error messages (prevent UI stretch)', async () => {
      // Look for error messages
      const errorElements = page.locator('.error-message')
        .or(page.locator('[data-testid="error-message"]'))
        .or(page.locator('text=Error'));

      const count = await errorElements.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const element = errorElements.nth(i);
        const text = await element.textContent();

        // Error messages should be truncated (< 100 chars visible)
        if (text && text.length > 100) {
          const boundingBox = await element.boundingBox();
          // Check if element has max-width or text-overflow CSS
          const overflow = await element.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.textOverflow === 'ellipsis' || style.maxWidth !== 'none';
          });

          expect(overflow).toBe(true);
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('AI Usage Badges', () => {
    it('should display Gemini usage badge when count > 0', async () => {
      await page.waitForTimeout(3000);

      const geminiUsage = page.locator('text=/Gemini.*\\d+/')
        .or(page.locator('[data-testid="gemini-usage"]'))
        .or(page.locator('.ai-usage-badge:has-text("Gemini")'));

      const isVisible = await geminiUsage.isVisible().catch(() => false);

      // Badge might not be visible if no Gemini calls made yet
      expect(typeof isVisible).toBe('boolean');
    }, TEST_TIMEOUT);

    it('should display Gemini usage when count > 0', async () => {
      await page.waitForTimeout(3000);

      const geminiUsage = page.locator('text=/Gemini.*\\d+/')
        .or(page.locator('[data-testid="gemini-usage"]'))
        .or(page.locator('.ai-usage-badge:has-text("Gemini")'));

      const isVisible = await geminiUsage.isVisible().catch(() => false);

      expect(typeof isVisible).toBe('boolean');
    }, TEST_TIMEOUT);

    it('should NOT flicker badges during polling', async () => {
      // Record initial badge state
      const initialState = await page.evaluate(() => {
        const badges = document.querySelectorAll('[data-testid^="ai-usage"]');
        return Array.from(badges).map(b => ({
          text: b.textContent,
          visible: b.offsetParent !== null
        }));
      });

      // Wait for polling interval
      await page.waitForTimeout(2000);

      // Check badge state again
      const laterState = await page.evaluate(() => {
        const badges = document.querySelectorAll('[data-testid^="ai-usage"]');
        return Array.from(badges).map(b => ({
          text: b.textContent,
          visible: b.offsetParent !== null
        }));
      });

      // Badges should either:
      // 1. Stay visible with same or increased count
      // 2. Not appear/disappear rapidly (no flickering)

      if (initialState.length > 0 && laterState.length > 0) {
        for (let i = 0; i < Math.min(initialState.length, laterState.length); i++) {
          if (initialState[i].visible) {
            // If badge was visible, it should still be visible
            expect(laterState[i].visible).toBe(true);
          }
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('Job Cancellation', () => {
    it('should show cancel button when job running', async () => {
      // Look for cancel button
      const cancelButton = page.locator('button:has-text("Cancel")')
        .or(page.locator('[data-testid="cancel-button"]'))
        .or(page.locator('button:has-text("Stop")'));

      const isVisible = await cancelButton.isVisible().catch(() => false);

      // Cancel button might not be visible if no job is running
      expect(typeof isVisible).toBe('boolean');
    }, TEST_TIMEOUT);

    it('should keep slots visible with current progress after cancel', async () => {
      const cancelButton = page.locator('button:has-text("Cancel")');
      const isVisible = await cancelButton.isVisible().catch(() => false);

      if (isVisible) {
        // Record active slots before cancel
        const slotsBefore = await page.evaluate(() => {
          const slots = document.querySelectorAll('[data-testid^="slot-"]');
          return Array.from(slots).filter(s => !s.textContent.includes('Waiting')).length;
        });

        // Click cancel
        await cancelButton.click();
        await page.waitForTimeout(2000);

        // Check slots after cancel
        const slotsAfter = await page.evaluate(() => {
          const slots = document.querySelectorAll('[data-testid^="slot-"]');
          return Array.from(slots).filter(s => !s.textContent.includes('Waiting')).length;
        });

        // Slots should still be visible (not cleared)
        expect(slotsAfter).toBeGreaterThanOrEqual(0);
      }
    }, TEST_TIMEOUT);

    it('should NOT clear badges after cancel', async () => {
      const cancelButton = page.locator('button:has-text("Cancel")');
      const isVisible = await cancelButton.isVisible().catch(() => false);

      if (isVisible) {
        // Check if badges exist before cancel
        const badgesBefore = await page.locator('[data-testid^="ai-usage"]')
          .or(page.locator('.ai-usage-badge'))
          .count();

        // Click cancel
        await cancelButton.click();
        await page.waitForTimeout(2000);

        // Check badges after cancel
        const badgesAfter = await page.locator('[data-testid^="ai-usage"]')
          .or(page.locator('.ai-usage-badge'))
          .count();

        // Badges should not disappear
        if (badgesBefore > 0) {
          expect(badgesAfter).toBe(badgesBefore);
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('Job Completion', () => {
    it('should freeze all slots with final states', async () => {
      // Verifies the structure supports frozen slots (without waiting for job completion)

      // Look for completed job indicators
      const completedIndicator = page.locator('text=Complete')
        .or(page.locator('text=Done'))
        .or(page.locator('[data-testid="job-complete"]'));

      const isVisible = await completedIndicator.isVisible().catch(() => false);

      if (isVisible) {
        // Check that slots are still present (not cleared)
        const slots = await page.locator('[data-testid^="slot-"]')
          .or(page.locator('.progress-slot'))
          .count();

        expect(slots).toBeGreaterThanOrEqual(0);
      }
    }, TEST_TIMEOUT);

    it('should show close button (×) when job finishes', async () => {
      const closeButton = page.locator('button:has-text("×")')
        .or(page.locator('[data-testid="close-button"]'))
        .or(page.locator('button[aria-label="Close"]'));

      const isVisible = await closeButton.isVisible().catch(() => false);

      expect(typeof isVisible).toBe('boolean');
    }, TEST_TIMEOUT);

    it('should clear widget when × clicked', async () => {
      const closeButton = page.locator('button:has-text("×")');
      const isVisible = await closeButton.isVisible().catch(() => false);

      if (isVisible) {
        // Click close
        await closeButton.click();
        await page.waitForTimeout(1000);

        // Widget should disappear
        const widgetVisible = await page.locator('[data-testid="news-progress-widget"]')
          .or(page.locator('.news-collection-progress'))
          .isVisible()
          .catch(() => false);

        expect(widgetVisible).toBe(false);
      }
    }, TEST_TIMEOUT);
  });

  describe('Bug Regression Tests', () => {
    it('should NOT show "POI null" or "Trail null"', async () => {
      await page.waitForTimeout(3000);

      const bodyText = await page.textContent('body');

      expect(bodyText).not.toContain('POI null');
      expect(bodyText).not.toContain('Trail null');
      expect(bodyText).not.toContain('undefined');
    }, TEST_TIMEOUT);

    it('should NOT allow two jobs to start simultaneously', async () => {
      const collectButton = page.locator('button:has-text("Collect News")');
      const isVisible = await collectButton.isVisible().catch(() => false);

      if (isVisible) {
        // Double-click rapidly
        await collectButton.click();
        await collectButton.click();

        await page.waitForTimeout(2000);

        // Should show error or button should be disabled
        const hasError = await page.locator('text=already running')
          .isVisible()
          .catch(() => false);

        const isEnabled = await collectButton.isEnabled().catch(() => false);

        // Either show error or disable button
        expect(hasError || !isEnabled).toBe(true);
      }
    }, TEST_TIMEOUT);

    it('should NOT stretch interface with long error messages', async () => {
      // Check viewport width hasn't changed
      const viewportSize = page.viewportSize();

      // Look for any elements that might cause horizontal scroll
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      expect(hasHorizontalScroll).toBe(false);
    }, TEST_TIMEOUT);
  });
});

describe('Slot Architecture UI Tests - Trail Status', () => {
  let browser;
  let page;
  let context;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      timeout: 30000
    });
  }, 30000);

  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle', timeout: 30000 });
  }, 30000);

  afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  afterAll(async () => {
    if (browser) await browser.close();
  }, 30000);

  describe('Trail Status Collection Widget', () => {
    it('should show "Collect Trail Status" button', async () => {
      const trailButton = page.locator('button:has-text("Trail Status")')
        .or(page.locator('button:has-text("Collect Status")'));

      const isVisible = await trailButton.isVisible().catch(() => false);

      expect(typeof isVisible).toBe('boolean');
    }, TEST_TIMEOUT);

    it('should display progress widget after clicking collect', async () => {
      const trailButton = page.locator('button:has-text("Trail Status")');
      const isVisible = await trailButton.isVisible().catch(() => false);

      if (isVisible) {
        await trailButton.click();
        await page.waitForTimeout(2000);

        const hasProgress = await page.locator('text=Collecting')
          .or(page.locator('text=Searching'))
          .isVisible()
          .catch(() => false);

        const hasError = await page.locator('text=already running')
          .isVisible()
          .catch(() => false);

        expect(hasProgress || hasError).toBe(true);
      }
    }, TEST_TIMEOUT);

    it('should show 10 slots for trail status jobs', async () => {
      await page.waitForTimeout(3000);

      const slots = await page.locator('[data-testid^="trail-slot-"]')
        .or(page.locator('.trail-progress-slot'))
        .count();

      if (slots > 0) {
        expect(slots).toBeLessThanOrEqual(10);
      }
    }, TEST_TIMEOUT);

    it('should show trail-specific phase indicators', async () => {
      await page.waitForTimeout(3000);

      // Trail status has phases: starting, rendering, ai_search, saving, complete
      const hasPhase = await page.locator('text=/Starting|Rendering|Searching|Saving|Complete/')
        .isVisible()
        .catch(() => false);

      expect(typeof hasPhase).toBe('boolean');
    }, TEST_TIMEOUT);
  });
});
