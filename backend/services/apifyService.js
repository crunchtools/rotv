const APIFY_BASE_URL = 'https://api.apify.com/v2';
const FACEBOOK_ACTOR_ID = 'apify~facebook-posts-scraper';

async function getApifyToken(pool) {
  try {
    const tokenRow = await pool.query(
      `SELECT value FROM admin_settings WHERE key = 'apify_api_token'`
    );
    if (tokenRow.rows.length > 0 && tokenRow.rows[0].value) {
      return tokenRow.rows[0].value;
    }
  } catch (err) {
    console.error('[Apify] Error loading API token:', err.message);
  }
  return null;
}

async function runActorSync(actorId, input, token) {
  const url = `${APIFY_BASE_URL}/acts/${actorId}/run-sync-get-dataset-items?token=${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Apify API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

function extractFacebookPageUrl(url) {
  const match = url.match(/(?:www\.)?facebook\.com\/([A-Za-z0-9._-]+)/);
  return match ? `https://www.facebook.com/${match[1]}/` : null;
}

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

export function isFacebookUrl(url) {
  return url.includes('facebook.com');
}

export async function testApifyToken(pool) {
  const token = await getApifyToken(pool);
  if (!token) {
    return false;
  }

  try {
    const url = `${APIFY_BASE_URL}/acts?token=${token}&limit=1`;
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });

    return response.ok;
  } catch (err) {
    console.error('[Apify] API token test failed:', err.message);
    return false;
  }
}
