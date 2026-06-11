import { describe, it, expect, beforeEach, vi } from 'vitest';

import { fetchBlueskyPosts, isBlueskyUrl } from '../services/blueskyService.js';

function feedItem(text, createdAt, reason = undefined) {
  return {
    reason,
    post: { record: { text, createdAt } }
  };
}

describe('Bluesky Service', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isBlueskyUrl', () => {
    it('matches bsky.app profile URLs', () => {
      expect(isBlueskyUrl('https://bsky.app/profile/smpmountainbike.bsky.social')).toBe(true);
    });

    it('rejects non-profile and non-Bluesky URLs', () => {
      expect(isBlueskyUrl('https://www.facebook.com/summitmetroparks')).toBe(false);
      expect(isBlueskyUrl('https://x.com/CVNPmtb')).toBe(false);
      expect(isBlueskyUrl('https://bsky.app/search?q=trails')).toBe(false);
    });
  });

  describe('fetchBlueskyPosts', () => {
    it('fetches the author feed and formats posts as dated markdown', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          feed: [
            feedItem('5/27/26 The trails are open. Enjoy the ride and be safe!', '2026-05-27T12:34:41.142Z'),
            feedItem('Hampton Hills Mountain Bike area is closed due to the rain.', '2026-05-20T02:16:07.643Z')
          ]
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchBlueskyPosts('https://bsky.app/profile/smpmountainbike.bsky.social');

      expect(result.reachable).toBe(true);
      expect(result.markdown).toBe(
        '[2026-05-27T12:34:41.142Z] 5/27/26 The trails are open. Enjoy the ride and be safe!' +
        '\n\n---\n\n' +
        '[2026-05-20T02:16:07.643Z] Hampton Hills Mountain Bike area is closed due to the rain.'
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('app.bsky.feed.getAuthorFeed');
      expect(calledUrl).toContain('actor=smpmountainbike.bsky.social');
      expect(calledUrl).toContain('filter=posts_no_replies');
    });

    it('filters out reposts and empty posts', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          feed: [
            feedItem('Reposted trail news', '2026-05-28T10:00:00.000Z', { $type: 'app.bsky.feed.defs#reasonRepost' }),
            feedItem('', '2026-05-27T09:00:00.000Z'),
            feedItem('Trails are open!', '2026-05-26T08:00:00.000Z')
          ]
        })
      }));

      const result = await fetchBlueskyPosts('https://bsky.app/profile/smpmountainbike.bsky.social');

      expect(result.reachable).toBe(true);
      expect(result.markdown).toBe('[2026-05-26T08:00:00.000Z] Trails are open!');
    });

    it('skips posts without a createdAt timestamp', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          feed: [
            feedItem('Undated status post', undefined),
            feedItem('Trails are open!', '2026-05-26T08:00:00.000Z')
          ]
        })
      }));

      const result = await fetchBlueskyPosts('https://bsky.app/profile/smpmountainbike.bsky.social');

      expect(result.reachable).toBe(true);
      expect(result.markdown).toBe('[2026-05-26T08:00:00.000Z] Trails are open!');
    });

    it('returns unreachable for a URL without a profile handle', async () => {
      const result = await fetchBlueskyPosts('https://example.com/not-bluesky');

      expect(result.reachable).toBe(false);
      expect(result.markdown).toBeNull();
      expect(result.reason).toBe('invalid Bluesky URL');
    });

    it('returns reachable with no markdown when the feed is empty', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ feed: [] })
      }));

      const result = await fetchBlueskyPosts('https://bsky.app/profile/empty.bsky.social');

      expect(result.reachable).toBe(true);
      expect(result.markdown).toBeNull();
      expect(result.reason).toBe('no posts found');
    });

    it('returns unreachable on API errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Profile not found'
      }));

      const result = await fetchBlueskyPosts('https://bsky.app/profile/missing.bsky.social');

      expect(result.reachable).toBe(false);
      expect(result.markdown).toBeNull();
      expect(result.reason).toContain('Bluesky API error 400');
    });
  });
});
