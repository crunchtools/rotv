const BLUESKY_API_BASE = 'https://public.api.bsky.app/xrpc';

export async function fetchBlueskyPosts(statusUrl, maxItems = 15) {
  const handleMatch = statusUrl.match(/bsky\.app\/profile\/([^/?#]+)/);
  if (!handleMatch) {
    console.log(`[Bluesky] Could not extract handle from: ${statusUrl}`);
    return { markdown: null, reachable: false, reason: 'invalid Bluesky URL' };
  }
  const handle = handleMatch[1];

  console.log(`[Bluesky] Fetching posts for @${handle} (max ${maxItems})...`);

  try {
    const apiUrl = `${BLUESKY_API_BASE}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${maxItems}&filter=posts_no_replies`;
    const response = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Bluesky API error ${response.status}: ${errorText}`);
    }

    const authorFeed = await response.json();
    const feed = authorFeed.feed || [];

    if (feed.length === 0) {
      console.log(`[Bluesky] No posts found for @${handle}`);
      return { markdown: null, reachable: true, reason: 'no posts found' };
    }

    // Fix: skip posts without createdAt — an undated post would reintroduce the
    // date mis-attribution this driver exists to prevent (PR #470 review)
    const posts = feed
      .filter(item => !item.reason) // reposts carry a reason (e.g. reasonRepost); originals don't
      .filter(item => (item.post?.record?.text || '').trim().length > 0)
      .filter(item => {
        if (!item.post.record.createdAt) {
          console.warn(`[Bluesky] Skipping post without createdAt for @${handle}`);
          return false;
        }
        return true;
      })
      .map(item => `[${item.post.record.createdAt}] ${item.post.record.text}`);

    if (posts.length === 0) {
      console.log(`[Bluesky] Posts returned but no text content for @${handle}`);
      return { markdown: null, reachable: true, reason: 'posts found but no text content' };
    }

    const markdown = posts.join('\n\n---\n\n');
    console.log(`[Bluesky] Got ${posts.length} posts for @${handle} (${markdown.length} chars)`);

    return { markdown, reachable: true };
  } catch (err) {
    console.error(`[Bluesky] Fetch error for @${handle}:`, err.message);
    return { markdown: null, reachable: false, reason: `Bluesky error: ${err.message}` };
  }
}

export function isBlueskyUrl(url) {
  return url.includes('bsky.app/profile/');
}
