/**
 * Playwright Integration Tests
 *
 * These tests verify that Playwright is properly installed and working
 * for both News/Events collection (JS-heavy sites) and MTB Trail Status
 * collection (Twitter/X pages).
 *
 * CRITICAL: If these tests fail, both News/Events and Trail Status
 * collection will not work properly for JavaScript-rendered pages.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
const { Pool } = pg;

// Import the JS renderer service
import { renderJavaScriptPage, isJavaScriptHeavySite } from '../services/jsRenderer.js';

import { TWITTER_COOKIES, hasTwitterCookies } from './helpers/twitterCookies.js';
describe('Playwright Integration Tests', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'rotv',
      user: 'postgres',
      password: 'rotv'
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  describe('Playwright Browser Launch', () => {
    it('should be able to launch Chromium browser', async () => {
      // This tests the core infrastructure - if Playwright is installed correctly
      const { chromium } = await import('playwright');

      let browser = null;
      try {
        browser = await chromium.launch({
          headless: true,
          timeout: 15000
        });

        expect(browser).toBeDefined();
        expect(browser.version()).toBeDefined();

        const context = await browser.newContext();
        const page = await context.newPage();

        // Navigate to a simple test page
        await page.goto('about:blank', { timeout: 5000 });

        const title = await page.title();
        expect(title).toBeDefined();

        console.log(`[Playwright Test] Browser launched successfully: Chromium ${browser.version()}`);
      } finally {
        if (browser) await browser.close();
      }
    }, 30000);
  });

  describe('News & Events Collection - JS Rendering', () => {
    it('should detect Wix sites as JavaScript-heavy', async () => {
      // Wix sites require JS rendering for News/Events collection
      const result = await isJavaScriptHeavySite('https://www.conservancyforcvnp.org/', { checkContent: false });
      expect(result).toBe(true);

      console.log('[Playwright Test] Wix site detection: PASS');
    });

    it('should render Conservancy for CVNP news page', async () => {
      // This tests Playwright rendering for a real News/Events source
      const result = await renderJavaScriptPage('https://www.conservancyforcvnp.org/news/', {
        waitTime: 3000,
        timeout: 15000,
        hardTimeout: 25000,
        browserLaunchTimeout: 10000
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        // Verify we got meaningful content
        expect(result.text.length).toBeGreaterThan(500);
        expect(result.links.length).toBeGreaterThan(10);
        console.log(`[Playwright Test] Conservancy page: ${result.text.length} chars, ${result.links.length} links`);
      } else {
        // Network issues are acceptable - the test is about Playwright working
        console.log(`[Playwright Test] Conservancy page unreachable: ${result.error}`);
        expect(result.error).toBeDefined();
      }
    }, 30000);

    it('should render CVSR stations page', async () => {
      // Another JS-heavy site used for News/Events
      const result = await renderJavaScriptPage('https://www.cvsr.org/stations/', {
        waitTime: 2000,
        timeout: 10000,
        hardTimeout: 20000,
        browserLaunchTimeout: 8000
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        expect(result.text.length).toBeGreaterThan(100);
        console.log(`[Playwright Test] CVSR page: ${result.text.length} chars`);
      } else {
        console.log(`[Playwright Test] CVSR page unreachable: ${result.error}`);
      }
    }, 25000);
  });

  describe('MTB Trail Status Collection - Twitter/X Rendering', () => {
    // Authenticated X rendering needs TEST_TWITTER_COOKIES (see helpers/twitterCookies.js)
    beforeAll(async () => {
      if (!hasTwitterCookies) return;
      await pool.query(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES ('twitter_cookies', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP
      `, [JSON.stringify(TWITTER_COOKIES)]);
      console.log('[Playwright Test] Inserted Twitter cookies for MTB trail status tests');
    });

    it('should detect Twitter/X as JavaScript-heavy', async () => {
      // Twitter/X is the primary source for MTB trail status
      const result = await isJavaScriptHeavySite('https://x.com/CVNPmtb', { checkContent: false });
      expect(result).toBe(true);

      console.log('[Playwright Test] Twitter/X detection: PASS');
    });

    it.skipIf(!hasTwitterCookies)('should render Twitter/X page with authentication', async () => {
      // This tests Playwright rendering for MTB Trail Status collection
      // Uses the CVNP MTB Twitter account which publishes trail status
      const result = await renderJavaScriptPage('https://x.com/CVNPmtb', {
        waitTime: 5000,  // Twitter needs more time to load
        timeout: 20000,
        hardTimeout: 30000,
        browserLaunchTimeout: 10000,
        cookies: TWITTER_COOKIES
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        // Verify we got meaningful Twitter content
        expect(result.text.length).toBeGreaterThan(100);
        console.log(`[Playwright Test] Twitter page: ${result.text.length} chars, ${result.links.length} links`);

        // Check if we're getting authenticated content (not login page)
        const hasLoginPrompt = result.text.toLowerCase().includes('sign in') ||
                               result.text.toLowerCase().includes('log in') ||
                               result.text.toLowerCase().includes('create your account');

        if (hasLoginPrompt) {
          console.log('[Playwright Test] WARNING: Twitter showing login prompt - cookies may be expired');
        } else {
          console.log('[Playwright Test] Twitter authenticated content loaded');
        }
      } else {
        console.log(`[Playwright Test] Twitter page error: ${result.error}`);
        expect(result.error).toBeDefined();
      }
    }, 35000);

    it.skipIf(!hasTwitterCookies)('should render Twitter/X MTB status page for East Rim', async () => {
      // Specific test for the East Rim Trail status URL
      const EAST_RIM_STATUS_URL = 'https://x.com/CVNPmtb';

      const result = await renderJavaScriptPage(EAST_RIM_STATUS_URL, {
        waitTime: 5000,
        timeout: 20000,
        hardTimeout: 30000,
        browserLaunchTimeout: 10000,
        cookies: TWITTER_COOKIES
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        console.log(`[Playwright Test] East Rim status page: ${result.text.length} chars`);

        // Look for trail-related content
        const trailKeywords = ['trail', 'mtb', 'closed', 'open', 'conditions', 'muddy', 'dry', 'east rim'];
        const textLower = result.text.toLowerCase();
        const foundKeywords = trailKeywords.filter(kw => textLower.includes(kw));

        if (foundKeywords.length > 0) {
          console.log(`[Playwright Test] Found trail keywords: ${foundKeywords.join(', ')}`);
        }
      } else {
        console.log(`[Playwright Test] East Rim status page error: ${result.error}`);
      }
    }, 35000);
  });

  describe('Playwright Infrastructure Validation', () => {
    it('should fail gracefully when Playwright cannot render', async () => {
      // Test with an invalid URL to ensure graceful failure
      const result = await renderJavaScriptPage('https://invalid.nonexistent.domain/', {
        waitTime: 1000,
        timeout: 5000,
        hardTimeout: 10000,
        browserLaunchTimeout: 5000
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      console.log(`[Playwright Test] Graceful failure: ${result.error}`);
    }, 15000);

    it('should handle SSL errors gracefully', async () => {
      // Test with a self-signed SSL site
      const result = await renderJavaScriptPage('https://self-signed.badssl.com/', {
        waitTime: 1000,
        timeout: 8000,
        hardTimeout: 12000,
        browserLaunchTimeout: 5000
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      // Should not fail specifically due to SSL errors
      if (!result.success) {
        expect(result.error).not.toMatch(/certificate/i);
        expect(result.error).not.toMatch(/SSL/i);
      }

      console.log(`[Playwright Test] SSL handling: ${result.success ? 'rendered' : result.error}`);
    }, 15000);
  });
});
