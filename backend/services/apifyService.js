/**
 * Apify Service
 * Fetches Twitter/X and Facebook posts via Apify cloud scrapers.
 * Used by trailStatusService for URLs that can't be extracted with Playwright + Readability.
 */

const APIFY_BASE_URL = 'https://api.apify.com/v2';

// Actor IDs for Twitter and Facebook scrapers
const TWITTER_ACTOR_ID = 'apidojo~tweet-scraper';
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
 * @param {string} actorId - Apify actor ID (e.g., 'apify~twitter-scraper')
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
 * Extract Twitter/X handle from a URL
 * @param {string} url - Twitter/X URL (e.g., 'https://x.com/CVNPmtb')
 * @returns {string|null} - Handle without @ prefix, or null
 */
function extractTwitterHandle(url) {
  const match = url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
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
 * Fetch recent Twitter/X posts for a user handle via Apify
 * @param {Pool} pool - Database connection pool
 * @param {string} statusUrl - Twitter/X URL (e.g., 'https://x.com/CVNPmtb')
 * @param {number} maxItems - Maximum number of posts to fetch (default: 10)
 * @returns {Object} - { markdown: string|null, reachable: boolean, reason?: string }
 */
export async function fetchTwitterPosts(pool, statusUrl, maxItems = 10) {
  const handle = extractTwitterHandle(statusUrl);
  if (!handle) {
    console.log(`[Apify] Could not extract Twitter handle from: ${statusUrl}`);
    return { markdown: null, reachable: false, reason: 'invalid Twitter URL' };
  }

  const token = await getApifyToken(pool);
  if (!token) {
    console.log('[Apify] No API token configured');
    return { markdown: null, reachable: false, reason: 'Apify API token not configured' };
  }

  console.log(`[Apify] Fetching Twitter posts for @${handle} (max ${maxItems})...`);

  try {
    const items = await runActorSync(TWITTER_ACTOR_ID, {
      twitterHandles: [handle],
      maxItems,
      sort: 'Latest'
    }, token);

    if (!items || items.length === 0) {
      console.log(`[Apify] No Twitter posts found for @${handle}`);
      return { markdown: null, reachable: true, reason: 'no posts found' };
    }

    // Log first item keys for debugging field names
    if (items.length > 0) {
      console.log(`[Apify] Twitter response fields: ${Object.keys(items[0]).join(', ')}`);
      const sample = items[0];
      console.log(`[Apify] Sample item: text=${sample.text?.substring(0, 80)}, full_text=${sample.full_text?.substring(0, 80)}, tweetText=${sample.tweetText?.substring(0, 80)}, content=${sample.content?.substring(0, 80)}`);
    }

    // Concatenate post text with timestamps
    const posts = items
      .map(item => {
        const text = item.text || item.full_text || item.tweetText || item.content || '';
        const date = item.createdAt || item.created_at || item.timestamp || '';
        return date ? `[${date}] ${text}` : text;
      })
      .filter(text => text.trim().length > 0);

    if (posts.length === 0) {
      console.log(`[Apify] Twitter posts returned but no text content for @${handle} (${items.length} items)`);
      return { markdown: null, reachable: true, reason: 'posts found but no text content' };
    }

    const markdown = posts.join('\n\n---\n\n');
    console.log(`[Apify] Got ${posts.length} Twitter posts for @${handle} (${markdown.length} chars)`);

    return { markdown, reachable: true };
  } catch (err) {
    console.error(`[Apify] Twitter fetch error for @${handle}:`, err.message);
    return { markdown: null, reachable: false, reason: `Apify error: ${err.message}` };
  }
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
 * Check if a URL is a Twitter/X URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function isTwitterUrl(url) {
  return url.includes('x.com') || url.includes('twitter.com');
}

/**
 * Check if a URL is a Facebook URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function isFacebookUrl(url) {
  return url.includes('facebook.com');
}
