const APIFY_BASE_URL = 'https://api.apify.com/v2';
const FACEBOOK_ACTOR_ID = 'apify~facebook-posts-scraper';
const SOCIAL_MAX_POSTS = 10;

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

export function isFacebookUrl(url) {
  return typeof url === 'string' && url.includes('facebook.com');
}

export function toIsoDate(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  if (/^\d+$/.test(str)) {
    let n = Number(str);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 1e12) n *= 1000;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().substring(0, 10);
  }

  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().substring(0, 10);
}

export async function fetchFacebookPosts(pool, statusUrl, maxItems = SOCIAL_MAX_POSTS) {
  const token = await getApifyToken(pool);
  if (!token) {
    console.log('[Apify] No API token configured');
    return { markdown: null, reachable: false, reason: 'Apify API token not configured' };
  }

  const target = extractFacebookPageUrl(statusUrl);
  if (!target) {
    console.log(`[Apify] Could not extract Facebook page from: ${statusUrl}`);
    return { markdown: null, reachable: false, reason: 'invalid Facebook URL' };
  }

  console.log(`[Apify] Fetching Facebook posts for ${target} (max ${maxItems})...`);

  try {
    const items = await runActorSync(FACEBOOK_ACTOR_ID, { startUrls: [{ url: target }], maxPosts: maxItems }, token);
    if (!items || items.length === 0) {
      console.log(`[Apify] No posts found for ${target}`);
      return { markdown: null, reachable: true, reason: 'no posts found' };
    }

    const posts = items
      .map(item => {
        const text = item.text || item.message || item.postText || '';
        const rawTs = item.timestamp ?? item.time ?? item.date ?? item.publishedTime ?? null;
        return { text: String(text).trim(), isoDate: toIsoDate(rawTs) };
      })
      .filter(p => p.text.length > 0);

    if (posts.length === 0) {
      console.log(`[Apify] Posts returned but no text content for ${target}`);
      return { markdown: null, reachable: true, reason: 'posts found but no text content' };
    }

    const markdown = posts.map(p => (p.isoDate ? `[${p.isoDate}] ${p.text}` : p.text)).join('\n\n---\n\n');
    console.log(`[Apify] Got ${posts.length} posts for ${target} (${markdown.length} chars)`);

    return { markdown, reachable: true, reason: null };
  } catch (err) {
    console.error(`[Apify] Facebook fetch error for ${target}:`, err.message);
    return { markdown: null, reachable: false, reason: `Apify error: ${err.message}` };
  }
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
