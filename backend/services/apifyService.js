/**
 * Apify Service
 * Fetches Facebook posts via Apify cloud scrapers.
 * Used by trailStatusService for Facebook URLs that can't be extracted with Playwright.
 *
 * Twitter/X uses Playwright + cookies directly (Apify Twitter actors are unreliable).
 */

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const FACEBOOK_ACTOR_ID = 'apify~facebook-posts-scraper';

/**
 * Load Apify API token from admin_settings table
 * @param {Pool} pool - Database connection pool
 * @returns {string|null} - API token or null if not configured
 */
async function getApifyToken(pool) {
  try {
    const result = await pool.query(
      `SELECT value FROM admin_settings WHERE key = 'apify_api_token'`
    );
    if (result.rows.length > 0 && result.rows[0].value) {
      return result.rows[0].value;
    }
  } catch (err) {
    console.error('[Apify] Error loading API token:', err.message);
  }
  return null;
}

/**
 * Call Apify actor sync API and return dataset items
 * @param {string} actorId - Apify actor ID
 * @param {Object} input - Actor input payload
 * @param {string} token - Apify API token
 * @returns {Array} - Array of result items
 */
async function runActorSync(actorId, input, token) {
  const url = `${APIFY_BASE_URL}/acts/${actorId}/run-sync-get-dataset-items?token=${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120000) // 2 minute timeout
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Apify API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Extract Facebook page URL from a status URL
 * Normalizes to https://www.facebook.com/pagename/ format
 * @param {string} url - Facebook URL
 * @returns {string|null} - Normalized page URL, or null
 */
function extractFacebookPageUrl(url) {
  const match = url.match(/(?:www\.)?facebook\.com\/([A-Za-z0-9._-]+)/);
  return match ? `https://www.facebook.com/${match[1]}/` : null;
}

/**
 * Fetch recent Facebook posts for a page via Apify
 * @param {Pool} pool - Database connection pool
 * @param {string} statusUrl - Facebook page URL
 * @param {number} maxItems - Maximum number of posts to fetch (default: 10)
 * @returns {Object} - { markdown: string|null, reachable: boolean, reason?: string }
 */
export async function fetchFacebookPosts(pool, statusUrl, maxItems = 10) {
  const pageUrl = extractFacebookPageUrl(statusUrl);
  if (!pageUrl) {
    console.log(`[Apify] Could not extract Facebook page from: ${statusUrl}`);
    return { markdown: null, reachable: false, reason: 'invalid Facebook URL' };
  }

  const token = await getApifyToken(pool);
  if (!token) {
    console.log('[Apify] No API token configured');
    return { markdown: null, reachable: false, reason: 'Apify API token not configured' };
  }

  console.log(`[Apify] Fetching Facebook posts for ${pageUrl} (max ${maxItems})...`);

  try {
    const items = await runActorSync(FACEBOOK_ACTOR_ID, {
      startUrls: [{ url: pageUrl }],
      maxPosts: maxItems
    }, token);

    if (!items || items.length === 0) {
      console.log(`[Apify] No Facebook posts found for ${pageUrl}`);
      return { markdown: null, reachable: true, reason: 'no posts found' };
    }

    // Concatenate post text with timestamps
    const posts = items
      .map(item => {
        const text = item.text || item.message || item.postText || '';
        const date = item.time || item.timestamp || item.date || '';
        return date ? `[${date}] ${text}` : text;
      })
      .filter(text => text.trim().length > 0);

    if (posts.length === 0) {
      console.log(`[Apify] Facebook posts returned but no text content for ${pageUrl}`);
      return { markdown: null, reachable: true, reason: 'posts found but no text content' };
    }

    const markdown = posts.join('\n\n---\n\n');
    console.log(`[Apify] Got ${posts.length} Facebook posts for ${pageUrl} (${markdown.length} chars)`);

    return { markdown, reachable: true };
  } catch (err) {
    console.error(`[Apify] Facebook fetch error for ${pageUrl}:`, err.message);
    return { markdown: null, reachable: false, reason: `Apify error: ${err.message}` };
  }
}

/**
 * Check if a URL is a Facebook URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function isFacebookUrl(url) {
  return url.includes('facebook.com');
}
