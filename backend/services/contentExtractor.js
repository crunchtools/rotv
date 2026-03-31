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

turndown.remove(['img', 'iframe', 'video', 'audio', 'svg', 'canvas', 'figure']);

/**
 * Extract page content as markdown using Playwright + Readability + Turndown.
 * @param {string} url - URL to extract content from
 * @param {Object} options - Extraction options
 * @param {number} options.timeout - Navigation timeout in ms (default: 15000)
 * @param {number} options.hardTimeout - Hard timeout for entire operation (default: 45000)
 * @param {number} options.maxLength - Max markdown length to return (default: 8000)
 * @param {boolean} options.extractLinks - Also extract <a> links with context for deep-link matching (default: false)
 * @param {number} options.dynamicContentWait - Wait time in ms for dynamic content after navigation (default: 2000)
 * @param {Array} options.cookies - Playwright cookies to inject before navigation (e.g., for Twitter auth)
 * @returns {Promise<{markdown: string, title: string, excerpt: string, reachable: boolean, links?: Array, reason?: string}>}
 */
export async function extractPageContent(url, options = {}) {
  const {
    timeout = 15000,
    hardTimeout = 45000,
    maxLength = 100000,
    extractLinks = false,
    dynamicContentWait = 2000,
    cookies = null
  } = options;

  if (!url || !url.trim()) {
    return { markdown: null, title: null, excerpt: null, reachable: false, reason: 'no source URL' };
  }

  let browser = null;
  let hardTimeoutId;

  try {
    const hardTimeoutPromise = new Promise((_, reject) => {
      hardTimeoutId = setTimeout(() => {
        reject(new Error(`Content extraction timed out after ${hardTimeout}ms`));
      }, hardTimeout);
    });

    const extractionPromise = (async () => {
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ]
      };
      if (process.env.PLAYWRIGHT_PROXY) {
        launchOptions.proxy = { server: process.env.PLAYWRIGHT_PROXY };
      }
      browser = await chromium.launch(launchOptions);

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true
      });

      if (cookies && Array.isArray(cookies) && cookies.length > 0) {
        const normalizeSameSite = (val) => {
          if (!val || val === 'no_restriction' || val === 'unspecified') return 'None';
          const lower = String(val).toLowerCase();
          if (lower === 'strict') return 'Strict';
          if (lower === 'lax') return 'Lax';
          return 'None';
        };
        const playwrightCookies = cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== false,
          httpOnly: c.httpOnly || false,
          sameSite: normalizeSameSite(c.sameSite)
        }));
        await context.addCookies(playwrightCookies);
      }

      const page = await context.newPage();

      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout });
      } catch (navError) {
        if (navError.message.includes('imeout')) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        } else {
          throw navError;
        }
      }

      await page.waitForTimeout(dynamicContentWait);

      const html = await page.content();
      const pageTitle = await page.title();

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

            let contextText = '';
            let parent = anchor.parentElement;
            let depth = 0;
            const MAX_PARENT_DEPTH = 3;
            const containerRegex = /\b(event|article|news|card|item|post)\b/i;
            while (parent && depth < MAX_PARENT_DEPTH) {
              const className = parent.className || '';
              if (containerRegex.test(className)) {
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

      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document, {
        charThreshold: 100
      });
      const article = reader.parse();

      if (!article || !article.content || article.content.trim().length < 200) {
        const fallbackDom = new JSDOM(html, { url });
        const body = fallbackDom.window.document.body;
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

      let markdown = turndown.turndown(article.content);
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

      return {
        markdown: markdown.slice(0, maxLength),
        title: article.title || pageTitle || null,
        excerpt: article.excerpt || markdown.slice(0, 200),
        reachable: true,
        ...(extractLinks && { links })
      };
    })();

    return await Promise.race([extractionPromise, hardTimeoutPromise]);

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
