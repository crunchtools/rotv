/**
 * Tests for JavaScript renderer (Playwright)
 */
import { describe, it, expect } from 'vitest';
import { isJavaScriptHeavySite, renderJavaScriptPage, extractEventContent } from '../services/jsRenderer.js';

describe('JavaScript Renderer', () => {
  describe('isJavaScriptHeavySite', () => {
    it('should detect Wix sites', async () => {
      const result = await isJavaScriptHeavySite('https://www.conservancyforcvnp.org/', { checkContent: false });
      expect(result).toBe(true);
    });

    it('should detect force-rendered sites', async () => {
      const result = await isJavaScriptHeavySite('https://www.preservethevalley.com/', { checkContent: false });
      expect(result).toBe(true);
    });

    it('should not detect regular sites', async () => {
      const result = await isJavaScriptHeavySite('https://www.example.com/', { checkContent: false });
      expect(result).toBe(false);
    });

    it('should handle invalid URLs gracefully', async () => {
      const result = await isJavaScriptHeavySite('No website available');
      expect(result).toBe(false);
    });
  });

  describe('renderJavaScriptPage', () => {
    it('should render Conservancy news page and extract links', async () => {
      const result = await renderJavaScriptPage('https://www.conservancyforcvnp.org/news/', {
        waitTime: 3000,
        timeout: 15000,
        hardTimeout: 25000, // Hard timeout for test - ensures we don't hang
        browserLaunchTimeout: 10000
      });

      // This test depends on an external website, so we accept graceful failure
      // The important thing is that it doesn't hang indefinitely
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      if (result.success) {
        // When the site is reachable, verify we get expected content
        expect(result.title).toContain('Conservancy');
        expect(result.text.length).toBeGreaterThan(1000);
        expect(result.links.length).toBeGreaterThan(50);
      } else {
        // When the site is slow/unreachable, verify graceful failure with error message
        expect(result.error).toBeDefined();
        console.log(`[Test] Conservancy site unreachable (expected during network issues): ${result.error}`);
      }
    }, 30000); // 30 second timeout for this test

    it('should handle timeout gracefully with fallback', async () => {
      // This test may pass or fail depending on network, but should not hang
      const result = await renderJavaScriptPage('https://www.cvsr.org/stations/', {
        waitTime: 2000,
        timeout: 10000,
        hardTimeout: 20000, // Hard timeout for test
        browserLaunchTimeout: 8000
      });

      // Should either succeed or fail gracefully
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    }, 25000);

    it('should ignore SSL errors', async () => {
      // Verifies the ignoreHTTPSErrors flag works with self-signed certs
      const result = await renderJavaScriptPage('https://self-signed.badssl.com/', {
        waitTime: 1000,
        timeout: 8000,
        hardTimeout: 12000, // Hard timeout for test
        browserLaunchTimeout: 5000
      });

      // Should not fail due to SSL certificate errors
      // (though it may fail for other reasons)
      if (!result.success) {
        expect(result.error).not.toContain('certificate');
        expect(result.error).not.toContain('SSL');
      }
    }, 15000);
  });

  describe('extractEventContent', () => {
    it('should extract event-related content', () => {
      const sampleText = `
        Home
        About
        Contact
        Upcoming Events
        Join us for a hike on January 15, 2026
        Nature walk in February
        Navigation footer
      `;

      const result = extractEventContent(sampleText);
      expect(result).toContain('January');
      expect(result).toContain('February');
      expect(result).not.toContain('Navigation footer');
    });

    it('should filter out navigation keywords', () => {
      const sampleText = 'Home\nAbout\nContact\nEvent on March 10';

      const result = extractEventContent(sampleText);
      expect(result).not.toContain('Home');
      expect(result).not.toContain('About');
      expect(result).toContain('March');
    });
  });
});
