import { extractPageContent } from './contentExtractor.js';
import { fetchSocialPosts, isSocialUrl } from './apifyService.js';

// Social (Facebook/Instagram) collection via Apify is on by default; absence of the setting
// means enabled. Read only for social URLs so non-social renders pay no extra query. (spec 036)
async function isApifySocialEnabled(pool) {
  try {
    const r = await pool.query(`SELECT value FROM admin_settings WHERE key = 'social_apify_collection_enabled'`);
    if (r.rows.length > 0 && r.rows[0].value != null) return String(r.rows[0].value).toLowerCase() !== 'false';
  } catch { /* default enabled on read failure */ }
  return true;
}

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
  } catch (err) { console.error('[Cache] Read failure:', err.message); }

  // Facebook/Instagram pages don't render usefully logged-out, so route them through Apify to
  // capture the real post timestamp (ogDates.socialDates). If disabled or no token, fall back to
  // the headless renderer + embedded-timestamp harvest in contentExtractor. (spec 036)
  const useApify = isSocialUrl(url) && await isApifySocialEnabled(pool);
  let rendered = useApify
    ? await fetchSocialPosts(pool, url, 10)
    : await extractPageContent(url, extractOptions);

  // Apify attempted but unavailable (no token / unreachable) — fall back to the headless renderer.
  if (useApify && (!rendered || rendered.reachable === false)) {
    rendered = await extractPageContent(url, extractOptions);
  }

  if (rendered.reachable && rendered.markdown) {
    try {
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
          page_type = COALESCE(EXCLUDED.page_type, rendered_page_cache.page_type),
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
      ]);
    } catch (err) { console.error('[Cache] Write failure:', err.message); }
  }

  return rendered;
}

export async function setCachePageType(pool, url, pageType) {
  try {
    await pool.query(
      'UPDATE rendered_page_cache SET page_type = $1 WHERE url = $2',
      [pageType, url]
    );
  } catch { /* non-fatal */ }
}

export async function setCacheItemCount(pool, url, contentType, count) {
  const col = contentType === 'event' ? 'item_count_events' : 'item_count_news';
  try {
    await pool.query(
      `UPDATE rendered_page_cache SET ${col} = $1 WHERE url = $2`,
      [count, url]
    );
  } catch { /* non-fatal */ }
}
