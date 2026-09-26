import { extractPageContent } from './contentExtractor.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Cache');

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

export async function renderPage(pool, url, options = {}) {
  const { pageType, ...extractOptions } = options;

  const cached = await pool.query(
    'SELECT * FROM rendered_page_cache WHERE url = $1',
    [url]
  ).catch((err) => {
    logger.error(`Read failure for ${url}: ${err.message}`);
    return { rows: [] };
  });
  const row = cached.rows[0];
  if (row && isCacheFresh(row) && row.markdown) {
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
