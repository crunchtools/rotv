const APIFY_BASE_URL = 'https://api.apify.com/v2';
const FACEBOOK_ACTOR_ID = 'apify~facebook-posts-scraper';
const INSTAGRAM_ACTOR_ID = 'apify~instagram-scraper';
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

export function isInstagramUrl(url) {
  return typeof url === 'string' && url.includes('instagram.com');
}

export function isSocialUrl(url) {
  return isFacebookUrl(url) || isInstagramUrl(url);
}

// The Apify Instagram scraper accepts profile, post, and reel URLs directly as directUrls.
function extractInstagramUrl(url) {
  return isInstagramUrl(url) ? url : null;
}

// Normalize an Apify post timestamp to YYYY-MM-DD. Handles ISO 8601 strings (Instagram
// `timestamp`, Facebook `time`) and unix epoch in seconds or milliseconds (Facebook
// `timestamp`, `taken_at`). Returns null for anything unparseable.
export function toIsoDate(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  if (/^\d+$/.test(str)) {
    let n = Number(str);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 1e12) n *= 1000; // epoch seconds → milliseconds
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().substring(0, 10);
  }

  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().substring(0, 10);
}

function socialFailure(reason) {
  return { markdown: null, rawText: null, ogDates: {}, ogImage: null, links: [], reachable: false, reason };
}

// Fetch posts from a Facebook page or Instagram profile/post via Apify and return a result
// shaped like contentExtractor's so renderPage can use it transparently. The post timestamps
// are surfaced as ogDates.socialDates (YYYY-MM-DD), the authoritative `social` date signal that
// logged-out headless rendering can't see. (spec 036)
export async function fetchSocialPosts(pool, url, maxItems = SOCIAL_MAX_POSTS) {
  const instagram = isInstagramUrl(url);

  const token = await getApifyToken(pool);
  if (!token) {
    console.log('[Apify] No API token configured');
    return socialFailure('Apify API token not configured');
  }

  let actorId, input, target;
  if (instagram) {
    target = extractInstagramUrl(url);
    if (!target) return socialFailure('invalid Instagram URL');
    actorId = INSTAGRAM_ACTOR_ID;
    input = { directUrls: [target], resultsType: 'posts', resultsLimit: maxItems };
  } else {
    target = extractFacebookPageUrl(url);
    if (!target) {
      console.log(`[Apify] Could not extract Facebook page from: ${url}`);
      return socialFailure('invalid Facebook URL');
    }
    actorId = FACEBOOK_ACTOR_ID;
    input = { startUrls: [{ url: target }], maxPosts: maxItems };
  }

  console.log(`[Apify] Fetching ${instagram ? 'Instagram' : 'Facebook'} posts for ${target} (max ${maxItems})...`);

  try {
    const items = await runActorSync(actorId, input, token);
    if (!items || items.length === 0) {
      console.log(`[Apify] No posts found for ${target}`);
      return { markdown: null, rawText: null, ogDates: {}, ogImage: null, links: [], reachable: true, reason: 'no posts found' };
    }

    const posts = items
      .map(item => {
        const text = item.caption || item.text || item.message || item.postText || '';
        const rawTs = item.timestamp ?? item.time ?? item.date
          ?? item.takenAt ?? item.takenAtTimestamp ?? item.taken_at ?? item.publishedTime ?? null;
        return { text: String(text).trim(), isoDate: toIsoDate(rawTs) };
      })
      .filter(p => p.text.length > 0);

    if (posts.length === 0) {
      console.log(`[Apify] Posts returned but no text content for ${target}`);
      return { markdown: null, rawText: null, ogDates: {}, ogImage: null, links: [], reachable: true, reason: 'posts found but no text content' };
    }

    const markdown = posts.map(p => (p.isoDate ? `[${p.isoDate}] ${p.text}` : p.text)).join('\n\n---\n\n');
    const socialDates = [...new Set(posts.map(p => p.isoDate).filter(Boolean))];
    console.log(`[Apify] Got ${posts.length} posts for ${target} (${socialDates.length} dated, ${markdown.length} chars)`);

    return {
      markdown,
      rawText: markdown,
      title: null,
      ogDates: { socialDates },
      ogImage: null,
      links: [],
      reachable: true
    };
  } catch (err) {
    console.error(`[Apify] Social fetch error for ${target}:`, err.message);
    return socialFailure(`Apify error: ${err.message}`);
  }
}

// Trail status entry point — preserves the original { markdown, reachable, reason } contract.
export async function fetchFacebookPosts(pool, statusUrl, maxItems = SOCIAL_MAX_POSTS) {
  const r = await fetchSocialPosts(pool, statusUrl, maxItems);
  return { markdown: r.markdown, reachable: r.reachable, reason: r.reason };
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
