import { acquireBrowser, releaseBrowser } from './browserPool.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Facebook');

/**
 * Facebook trail-status fetcher via the public Page Plugin.
 *
 * facebook.com/<page> is login-walled for anonymous visitors, but the official
 * embeddable Page Plugin (developers.facebook.com/docs/plugins/page-plugin)
 * serves a public Page's recent timeline to anyone — that's its whole purpose.
 * The timeline renders client-side, so it goes through the shared Chromium pool.
 * Each post carries an epoch timestamp in [data-utime], which gives us reliable
 * per-post dates (the visible text only says "last Monday").
 *
 * Replaces the paid Apify scraper (free tier exhausted by the 30-min cadence).
 */
const PLUGIN_BASE_URL = 'https://www.facebook.com/plugins/page.php';
const SOCIAL_MAX_POSTS = 10;
const NAV_TIMEOUT_MS = 45000;

const CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'America/New_York',
  viewport: { width: 520, height: 3000 }
};

export function extractFacebookPageUrl(url) {
  const match = String(url || '').match(/(?:www\.|m\.)?facebook\.com\/([A-Za-z0-9._-]+)/);
  return match ? `https://www.facebook.com/${match[1]}/` : null;
}

export function isFacebookUrl(url) {
  return typeof url === 'string' && url.includes('facebook.com');
}

export function buildPagePluginUrl(pageUrl) {
  const params = new URLSearchParams({
    href: pageUrl,
    tabs: 'timeline',
    width: '500',
    height: '3000',
    small_header: 'true',
    hide_cover: 'true',
    adapt_container_width: 'false'
  });
  return `${PLUGIN_BASE_URL}?${params}`;
}

export function toIsoDate(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  if (/^\d+$/.test(str)) {
    let n = Number(str);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 1e12) n *= 1000;  // epoch seconds → milliseconds
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().substring(0, 10);
  }

  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().substring(0, 10);
}

/* global document -- scrapePluginPosts runs in the browser via page.evaluate */
// Runs in the browser via page.evaluate, so it must stay self-contained.
// Anchors on [data-utime] (stable across Facebook's obfuscated class churn)
// and climbs to the largest ancestor that holds no other timestamp — that's
// the post root.
export function scrapePluginPosts() {
  const stamps = Array.from(document.querySelectorAll('[data-utime]'));
  const visibleText = el => (el.innerText ?? el.textContent ?? '');
  const posts = stamps.map(stamp => {
    const others = stamps.filter(s => s !== stamp);
    let root = stamp;
    while (root.parentElement && !others.some(o => root.parentElement.contains(o))) {
      root = root.parentElement;
    }
    const message = root.querySelector('[data-testid="post_message"], .userContent');
    return { utime: stamp.getAttribute('data-utime'), text: message ? visibleText(message) : '' };
  });
  return { posts, bodyText: document.body ? visibleText(document.body) : '' };
}

export function formatPosts(posts, maxItems = SOCIAL_MAX_POSTS) {
  return posts
    .map(p => ({ text: String(p.text || '').trim(), isoDate: toIsoDate(p.utime) }))
    .filter(p => p.text.length > 0)
    .slice(0, maxItems)
    .map(p => (p.isoDate ? `[${p.isoDate}] ${p.text}` : p.text))
    .join('\n\n---\n\n');
}

/**
 * Fetch a public Facebook Page's recent posts for trail-status extraction.
 *
 * @param {string} statusUrl - Any facebook.com Page URL (normalized to the Page root).
 * @param {number} [maxItems=10] - Maximum number of posts to include.
 * @returns {Promise<{markdown: string|null, reachable: boolean, reason: string|null}>}
 *   - reachable:true, markdown set — posts as "[YYYY-MM-DD] text" blocks joined by "---"
 *     (or raw plugin text if the post markup couldn't be parsed)
 *   - reachable:true, markdown null — plugin loaded but had no content ("no posts found")
 *   - reachable:false — invalid Page URL or render/navigation error; reason says which
 */
export async function fetchFacebookPosts(statusUrl, maxItems = SOCIAL_MAX_POSTS) {
  const target = extractFacebookPageUrl(statusUrl);
  if (!target) {
    logger.info(`Could not extract Facebook page from: ${statusUrl}`);
    return { markdown: null, reachable: false, reason: 'invalid Facebook URL' };
  }

  logger.info(`Fetching Facebook posts for ${target} via page plugin (max ${maxItems})...`);

  let acquisitionId = null;
  let context = null;
  try {
    const acquired = await acquireBrowser();
    acquisitionId = acquired.acquisitionId;
    context = await acquired.browser.newContext(CONTEXT_OPTIONS);
    const page = await context.newPage();
    await page.goto(buildPagePluginUrl(target), { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });

    const { posts, bodyText } = await page.evaluate(scrapePluginPosts);

    let markdown = formatPosts(posts, maxItems);
    if (!markdown && bodyText.trim()) {
      // Markup changed (no timestamps or no post_message) — hand the raw text
      // to the classifier rather than failing outright.
      logger.warn(`No parseable posts for ${target}; falling back to page text`);
      markdown = bodyText.trim();
    }

    if (!markdown) {
      logger.info(`No posts found for ${target}`);
      return { markdown: null, reachable: true, reason: 'no posts found' };
    }

    logger.info(`Got ${Math.min(posts.length, maxItems)} posts for ${target} (${markdown.length} chars)`);
    return { markdown, reachable: true, reason: null };
  } catch (err) {
    logger.error(`Facebook fetch error for ${target}:`, err.message);
    return { markdown: null, reachable: false, reason: `Facebook page plugin error: ${err.message}` };
  } finally {
    if (context) await context.close().catch(err => logger.debug(`Context close failed: ${err.message}`));
    if (acquisitionId !== null) releaseBrowser(acquisitionId);
  }
}
