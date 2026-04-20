/**
 * Render Page — cached wrapper around extractPageContent.
 * Checks rendered_page_cache before calling Playwright.
 * TTL: detail = forever, listing = 23h, trail_status = 25min.
 */

import { extractPageContent } from './contentExtractor.js';

const TTL_MS = {
  detail: Infinity,
  listing: 23 * 60 * 60 * 1000,
  trail_status: 25 * 60 * 1000
};

function isCacheFresh(row) {
  if (!row || !row.rendered_at) return false;
  const ttl = TTL_MS[row.page_type] ?? TTL_MS.listing;
  if (ttl === Infinity) return true;
  return (Date.now() - new Date(row.rendered_at).getTime()) < ttl;
}

/**
 * Render a page with cache. Checks rendered_page_cache first,
 * calls Playwright on miss or stale, saves result to cache.
 *
 * @param {Pool} pool - Database connection pool
 * @param {string} url - URL to render
 * @param {Object} [options] - Options passed to extractPageContent
 * @param {string} [options.pageType] - Hint for cache TTL ('detail', 'listing', 'trail_status')
 * @returns {Promise<Object>} - Same shape as extractPageContent
 */
export async function renderPage(pool, url, options = {}) {
  const { pageType, ...extractOptions } = options;

  try {
    const cached = await pool.query(
      'SELECT * FROM rendered_page_cache WHERE url = $1',
      [url]
    );
    if (cached.rows.length > 0 && isCacheFresh(cached.rows[0]) && cached.rows[0].markdown) {
      const row = cached.rows[0];
      return {
        markdown: row.markdown,
        rawText: row.raw_text,
        title: row.title,
        ogDates: row.og_dates || {},
        links: row.links || [],
        reachable: true,
        excerpt: row.markdown ? row.markdown.slice(0, 200) : null,
        cached: true
      };
    }
  } catch (err) { console.error('[Cache] Read failure:', err.message); }

  const rendered = await extractPageContent(url, extractOptions);

  if (rendered.reachable && rendered.markdown) {
    try {
      await pool.query(`
        INSERT INTO rendered_page_cache (url, markdown, raw_text, og_dates, title, links, page_type, rendered_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (url) DO UPDATE SET
          markdown = EXCLUDED.markdown,
          raw_text = EXCLUDED.raw_text,
          og_dates = EXCLUDED.og_dates,
          title = EXCLUDED.title,
          links = EXCLUDED.links,
          page_type = COALESCE(EXCLUDED.page_type, rendered_page_cache.page_type),
          rendered_at = NOW()
      `, [
        url,
        rendered.markdown,
        rendered.rawText || null,
        JSON.stringify(rendered.ogDates || {}),
        rendered.title || null,
        JSON.stringify(rendered.links || []),
        pageType || null
      ]);
    } catch (err) { console.error('[Cache] Write failure:', err.message); }
  }

  return rendered;
}

/**
 * Update the page_type for a cached URL (called after classification).
 *
 * @param {Pool} pool - Database connection pool
 * @param {string} url - URL to update
 * @param {string} pageType - 'listing' or 'detail'
 */
export async function setCachePageType(pool, url, pageType) {
  try {
    await pool.query(
      'UPDATE rendered_page_cache SET page_type = $1 WHERE url = $2',
      [pageType, url]
    );
  } catch { /* non-fatal */ }
}
