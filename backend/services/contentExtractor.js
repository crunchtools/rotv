/**
 * Content Extractor
 * Playwright renders → Readability extracts → Turndown converts to markdown.
 * Shared utility for both the news scraper and moderation pipeline.
 */

import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
});

// Remove images and iframes from markdown output — we only need text
turndown.remove(['img', 'iframe', 'video', 'audio', 'svg', 'canvas', 'figure']);

/**
 * Extract page content as markdown using Playwright + Readability + Turndown.
 * @param {string} url - URL to extract content from
 * @param {Object} options - Extraction options
 * @param {number} options.timeout - Navigation timeout in ms (default: 15000)
 * @param {number} options.hardTimeout - Hard timeout for entire operation (default: 45000)
 * @param {number} options.maxLength - Max markdown length to return (default: 8000)
 * @param {boolean} options.extractLinks - Also extract <a> links with context for deep-link matching (default: false)
 * @returns {Promise<{markdown: string, title: string, excerpt: string, reachable: boolean, links?: Array, reason?: string}>}
 */
export async function extractPageContent(url, options = {}) {
  const {
    timeout = 15000,
    hardTimeout = 45000,
    maxLength = 100000,
    extractLinks = false
  } = options;

  if (!url || !url.trim()) {
    return { markdown: null, title: null, excerpt: null, reachable: false, reason: 'no source URL' };
  }

  let browser = null;
  let hardTimeoutId;

  try {
    // Hard timeout safety net
    const hardTimeoutPromise = new Promise((_, reject) => {
      hardTimeoutId = setTimeout(() => {
        reject(new Error(`Content extraction timed out after ${hardTimeout}ms`));
      }, hardTimeout);
    });

    const extractionPromise = (async () => {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true
      });

      const page = await context.newPage();

      // Block unnecessary resources to speed up rendering
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      // Navigate with networkidle, fall back to domcontentloaded
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout });
      } catch (navError) {
        if (navError.message.includes('imeout')) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 10000) });
        } else {
          throw navError;
        }
      }

      // Brief wait for dynamic content
      await page.waitForTimeout(2000);

      // Get rendered HTML
      const html = await page.content();
      const pageTitle = await page.title();

      // Extract links before closing browser (if requested for deep-link matching)
      let links = [];
      if (extractLinks) {
        links = await page.evaluate(() => {
          const extracted = [];
          document.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.href;
            if (!href ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:') ||
                href.startsWith('#') ||
                href === window.location.href ||
                href.includes('facebook.com') ||
                href.includes('twitter.com') ||
                href.includes('instagram.com') ||
                href.includes('linkedin.com')) {
              return;
            }

            const linkText = anchor.innerText?.trim() || anchor.textContent?.trim() || '';

            // Walk up to find event/article container for context
            let contextText = '';
            let parent = anchor.parentElement;
            let depth = 0;
            while (parent && depth < 3) {
              const classList = Array.from(parent.classList || []);
              const className = parent.className || '';
              const isContainer = classList.some(c =>
                c.includes('event') || c.includes('article') || c.includes('news') ||
                c.includes('card') || c.includes('item') || c.includes('post')
              ) || className.includes('event') || className.includes('article');
              if (isContainer) {
                contextText = parent.innerText?.trim() || '';
                break;
              }
              parent = parent.parentElement;
              depth++;
            }
            if (!contextText && anchor.parentElement) {
              contextText = anchor.parentElement.innerText?.trim() || '';
            }
            if (contextText.length > 500) {
              contextText = contextText.substring(0, 500);
            }

            extracted.push({
              url: href,
              text: linkText,
              context: contextText,
              className: anchor.className || '',
              parentClassName: anchor.parentElement?.className || ''
            });
          });
          return extracted;
        });
      }

      await browser.close();
      browser = null;

      // Parse with Readability
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document, {
        charThreshold: 100
      });
      const article = reader.parse();

      if (!article || !article.content || article.content.trim().length < 50) {
        // Readability couldn't extract — fall back to body text
        const fallbackDom = new JSDOM(html, { url });
        const body = fallbackDom.window.document.body;
        // Remove script/style/nav elements
        for (const tag of ['script', 'style', 'nav', 'header', 'footer', 'aside']) {
          body.querySelectorAll(tag).forEach(el => el.remove());
        }
        const fallbackText = body.textContent.replace(/\s+/g, ' ').trim();
        return {
          markdown: fallbackText.slice(0, maxLength),
          title: pageTitle || null,
          excerpt: fallbackText.slice(0, 200),
          reachable: true,
          ...(extractLinks && { links })
        };
      }

      // Convert article HTML to markdown
      let markdown = turndown.turndown(article.content);

      // Clean up excessive whitespace
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

      return {
        markdown: markdown.slice(0, maxLength),
        title: article.title || pageTitle || null,
        excerpt: article.excerpt || markdown.slice(0, 200),
        reachable: true,
        ...(extractLinks && { links })
      };
    })();

    const result = await Promise.race([extractionPromise, hardTimeoutPromise]);
    return result;

  } catch (error) {
    return {
      markdown: null,
      title: null,
      excerpt: null,
      reachable: false,
      reason: error.name === 'AbortError' ? 'timeout' : error.message
    };
  } finally {
    clearTimeout(hardTimeoutId);
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
