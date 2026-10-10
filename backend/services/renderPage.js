import { extractPageContent } from './contentExtractor.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Cache');

const TTL_MS = {
  detail: Infinity,
  // A detail page that counted zero items may have rendered badly (WebTrac pages
  // served a "browser does not support javascript" shell, #732); forever would
  // never give it a second look.
  detail_empty: 7 * 24 * 60 * 60 * 1000,
  listing: 23 * 60 * 60 * 1000,
  trail_status: 25 * 60 * 1000
};

// A WAF refusal renders as a short page of its own (Cloudflare: "Why have I been
// blocked?"). Cached as content it was classified "neither" and served for a day,
// so the next daily crawl read the refusal instead of the listing.
const BLOCK_PAGE_RE = /why have i been blocked\?|sorry, you have been blocked|access denied\b.*\bsecurity service/i;

function isBlockPage(rendered) {
  const text = rendered.markdown || '';
  return text.length < 2000 && BLOCK_PAGE_RE.test(`${rendered.title || ''}\n${text}`);
}

/**
 * Whether a cached render can still be served.
 *
 * @param {object|undefined} row - A rendered_page_cache row
 * @param {'news'|'event'|null} contentType - The crawl asking; a detail page that
 *   counted zero items of this type expires after TTL_MS.detail_empty
 * @returns {boolean}
 */
export function isCacheFresh(row, contentType = null) {
  if (!row || !row.rendered_at) return false;
  let ttl = TTL_MS[row.page_type] ?? TTL_MS.listing;
  if (row.page_type === 'detail' && contentType) {
    const count = contentType === 'event' ? row.item_count_events : row.item_count_news;
    if (count === 0) ttl = TTL_MS.detail_empty;
  }
  if (ttl === Infinity) return true;
  return (Date.now() - new Date(row.rendered_at).getTime()) < ttl;
}

/**
 * Renders a page through the browser pool, or serves it from rendered_page_cache.
 *
 * @param {import('pg').Pool} pool
 * @param {string} url
 * @param {object} options - Extraction options, plus:
 * @param {string} [options.pageType] - Cache class for a fresh render ('detail', 'listing', 'trail_status')
 * @param {'news'|'event'} [options.contentType] - The crawl's content type. With it, a cached
 *   detail page that yielded no items of that type is re-rendered after seven days instead
 *   of being served forever; a re-render clears both cached item counts.
 * @returns {Promise<object>} The extracted page, with cached: true when served from cache
 */
export async function renderPage(pool, url, options = {}) {
  const { pageType, contentType, ...extractOptions } = options;

  const cached = await pool.query(
    'SELECT * FROM rendered_page_cache WHERE url = $1',
    [url]
  ).catch((err) => {
    logger.error(`Read failure for ${url}: ${err.message}`);
    return { rows: [] };
  });
  const row = cached.rows[0];
  if (row && isCacheFresh(row, contentType) && row.markdown) {
    return {
      markdown: row.markdown,
      rawText: row.raw_text,
      title: row.title,
      ogDates: row.og_dates || {},
      ogImage: row.og_image || null,
      links: row.links || [],
      reachable: true,
      excerpt: row.markdown ? row.markdown.slice(0, 200) : null,
      cached: true,
      pageType: row.page_type || null,
      itemCountNews: row.item_count_news ?? null,
      itemCountEvents: row.item_count_events ?? null
    };
  }

  const rendered = await extractPageContent(url, extractOptions);

  if (rendered.reachable && isBlockPage(rendered)) {
    logger.warn(`Blocked by site security: ${url}`);
    return { ...rendered, reachable: false, markdown: null, reason: 'blocked by site security' };
  }

  if (rendered.reachable && rendered.markdown) {
    await pool.query(`
      INSERT INTO rendered_page_cache (url, markdown, raw_text, og_dates, og_image, title, links, page_type, rendered_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (url) DO UPDATE SET
        markdown = EXCLUDED.markdown,
        raw_text = EXCLUDED.raw_text,
        og_dates = EXCLUDED.og_dates,
        og_image = EXCLUDED.og_image,
        title = EXCLUDED.title,
        links = EXCLUDED.links,
        page_type = EXCLUDED.page_type,
        item_count_news = NULL,
        item_count_events = NULL,
        rendered_at = NOW()
    `, [
      url,
      rendered.markdown,
      rendered.rawText || null,
      JSON.stringify(rendered.ogDates || {}),
      rendered.ogImage || null,
      rendered.title || null,
      JSON.stringify(rendered.links || []),
      pageType || null
    ]).catch((err) => logger.error(`Write failure for ${url}: ${err.message}`));
  }

  return rendered;
}

export async function setCachePageType(pool, url, pageType) {
  await pool.query(
    'UPDATE rendered_page_cache SET page_type = $1 WHERE url = $2',
    [pageType, url]
  ).catch((err) => logger.warn(`page_type update failed for ${url}: ${err.message}`));
}

export async function setCacheItemCount(pool, url, contentType, count) {
  const sql = contentType === 'event'
    ? 'UPDATE rendered_page_cache SET item_count_events = $1 WHERE url = $2'
    : 'UPDATE rendered_page_cache SET item_count_news = $1 WHERE url = $2';
  await pool.query(sql, [count, url])
    .catch((err) => logger.warn(`item count update failed for ${url}: ${err.message}`));
}
