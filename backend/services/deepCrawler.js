/**
 * Deep Crawler
 * Follows links from a source URL to find the actual article page
 * when the initial URL is a homepage or index page.
 */

import { extractPageContent } from './contentExtractor.js';
import { calculateSimilarity, contentMatchesItem } from './textUtils.js';

/**
 * Check if a URL looks like a generic/index page rather than a specific article.
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function isGenericUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');

    if (!path || path === '') return true;

    const genericPaths = [
      '/news', '/events', '/blog', '/press', '/about',
      '/articles', '/stories', '/updates', '/calendar',
      '/programs', '/activities', '/happenings'
    ];
    if (genericPaths.includes(path.toLowerCase())) return true;

    if (/\/(index|default|home)\.(html?|php|aspx?)$/i.test(path)) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Deep crawl from a source URL to find the actual article page.
 *
 * @param {string} sourceUrl - Starting URL (may be homepage/index)
 * @param {Object} item - { title, summary/description } to match against
 * @param {Object} options
 * @param {number} options.maxDepth - How many link-follow levels (default 2)
 * @param {number} options.maxPages - Hard cap on Playwright renders (default 5)
 * @param {boolean} options.sameOriginOnly - Only follow same-origin links (default true)
 * @param {number} options.timeoutMs - Overall timeout in ms (default 60000)
 * @param {Function} options.extractor - Content extraction function (default: extractPageContent). Accepts (url, opts).
 * @param {Object} options.prefetched - Pre-rendered listing page data to skip Level 0 render
 * @param {string} options.prefetched.markdown - Page content as markdown
 * @param {Array} options.prefetched.links - Extracted links from the page
 * @returns {Promise<{foundUrl: string|null, foundContent: string|null, pagesChecked: number}>}
 */
export async function deepCrawlForArticle(sourceUrl, item, options = {}) {
  const {
    maxDepth = 2,
    maxPages = 5,
    sameOriginOnly = true,
    timeoutMs = 60000,
    extractor = extractPageContent,
    prefetched = null
  } = options;

  const visited = new Set();
  let pagesChecked = 0;
  const deadline = Date.now() + timeoutMs;

  let sourceOrigin;
  try {
    sourceOrigin = new URL(sourceUrl).origin;
  } catch {
    return { foundUrl: null, foundContent: null, pagesChecked: 0 };
  }

  async function crawlLevel(urls, depth) {
    const candidateLinks = [];

    for (const url of urls) {
      if (pagesChecked >= maxPages) break;
      if (Date.now() >= deadline) break;
      if (visited.has(url)) continue;
      visited.add(url);

      pagesChecked++;
      console.log(`[Render] Rendering (depth=${depth}, page=${pagesChecked}/${maxPages}): ${url}`);

      const extracted = await extractor(url, {
        timeout: 15000,
        hardTimeout: 30000,
        extractLinks: depth < maxDepth
      });

      if (!extracted.reachable || !extracted.markdown) continue;

      if (contentMatchesItem(extracted.markdown, item)) {
        console.log(`[Render] Match found at depth ${depth}: ${url}`);
        return { foundUrl: url, foundContent: extracted.markdown };
      }

      if (extracted.links && depth < maxDepth) {
        for (const link of extracted.links) {
          if (visited.has(link.url)) continue;
          if (sameOriginOnly) {
            try {
              if (new URL(link.url).origin !== sourceOrigin) continue;
            } catch {
              continue;
            }
          }
          const desc = item.summary || item.description;
          const score =
            (item.title ? calculateSimilarity(item.title, link.text) * 3 + calculateSimilarity(item.title, link.context) * 2 : 0) +
            (desc ? calculateSimilarity(desc, link.text) + calculateSimilarity(desc, link.context) * 0.5 : 0);
          candidateLinks.push({ ...link, score });
        }
      }
    }

    return { candidateLinks };
  }

  let level0;
  if (prefetched && prefetched.markdown) {
    visited.add(sourceUrl);
    if (contentMatchesItem(prefetched.markdown, item)) {
      console.log(`[Render] Match found at depth 0 (prefetched): ${sourceUrl}`);
      return { foundUrl: sourceUrl, foundContent: prefetched.markdown, pagesChecked: 0 };
    }
    const candidateLinks = [];
    if (prefetched.links && maxDepth > 0) {
      for (const link of prefetched.links) {
        if (sameOriginOnly) {
          try {
            if (new URL(link.url).origin !== sourceOrigin) continue;
          } catch { continue; }
        }
        const desc = item.summary || item.description;
        const score =
          (item.title ? calculateSimilarity(item.title, link.text) * 3 + calculateSimilarity(item.title, link.context) * 2 : 0) +
          (desc ? calculateSimilarity(desc, link.text) + calculateSimilarity(desc, link.context) * 0.5 : 0);
        candidateLinks.push({ ...link, score });
      }
    }
    level0 = { candidateLinks };
  } else {
    level0 = await crawlLevel([sourceUrl], 0);
    if (level0.foundUrl) return { ...level0, pagesChecked };
  }

  let currentCandidates = level0.candidateLinks || [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (currentCandidates.length === 0) break;
    if (pagesChecked >= maxPages) break;
    if (Date.now() >= deadline) break;

    currentCandidates.sort((a, b) => b.score - a.score);
    const topUrls = currentCandidates
      .slice(0, Math.max(1, maxPages - pagesChecked))
      .filter(c => c.score > 0)
      .map(c => c.url);

    if (topUrls.length === 0) break;

    const levelResult = await crawlLevel(topUrls, depth);
    if (levelResult.foundUrl) return { ...levelResult, pagesChecked };

    currentCandidates = levelResult.candidateLinks || [];
  }

  console.log(`[Render] No match found after checking ${pagesChecked} pages`);
  return { foundUrl: null, foundContent: null, pagesChecked };
}
