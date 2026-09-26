import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

const FB_MARKDOWN = '[2026-09-23] 9/23 Open! Ride through puddles not around.\n\n---\n\n' + 'x'.repeat(250);

vi.mock('../services/facebookService.js', () => ({
  isFacebookUrl: (url) => url.includes('facebook.com'),
  fetchFacebookPosts: vi.fn(async () => ({ markdown: FB_MARKDOWN, reachable: true, reason: null }))
}));
vi.mock('../services/renderPage.js', () => ({ renderPage: vi.fn() }));
vi.mock('../services/blueskyService.js', () => ({ isBlueskyUrl: () => false, fetchBlueskyPosts: vi.fn() }));
vi.mock('../services/llmService.js', () => ({ generateTextWithCustomPrompt: vi.fn() }));

const { fetchFacebookPosts } = await import('../services/facebookService.js');
const { renderPage } = await import('../services/renderPage.js');
const { collectTrailStatus } = await import('../services/trailStatusService.js');

describe('collectTrailStatus Facebook routing', () => {
  it('sends Facebook status URLs to facebookService and feeds its content into the pipeline', async () => {
    const hash = crypto.createHash('sha256').update(FB_MARKDOWN).digest('hex');
    // Last saved row has the same content hash, so the pipeline takes the unchanged path.
    const pool = { query: vi.fn(async () => ({ rows: [{ content_hash: hash, created_at: new Date() }] })) };
    const poi = { id: 5999, name: 'Reagan-Huffman', status_url: 'https://www.facebook.com/medinaTRAILS/' };

    const result = await collectTrailStatus(pool, poi);

    expect(fetchFacebookPosts).toHaveBeenCalledWith(pool, 'https://www.facebook.com/medinaTRAILS/');
    expect(renderPage).not.toHaveBeenCalled();
    expect(result).toEqual({ statusFound: 1, statusSaved: 0, skipped: true });
  });

  it('counts consecutive Facebook failures (login wall) under facebook_consecutive_failures', async () => {
    fetchFacebookPosts.mockResolvedValueOnce({ markdown: null, reachable: false, reason: 'Facebook login required' });
    const pool = { query: vi.fn(async () => ({ rows: [{ value: '3' }] })) };
    const poi = { id: 5999, name: 'Reagan-Huffman', status_url: 'https://www.facebook.com/medinaTRAILS/' };

    const result = await collectTrailStatus(pool, poi);

    expect(result).toEqual({ statusFound: 0, statusSaved: 0 });
    const increments = pool.query.mock.calls.filter(([sql, params]) =>
      params?.[0] === 'facebook_consecutive_failures' && /::int \+ 1/.test(sql));
    expect(increments).toHaveLength(1);
    expect(pool.query.mock.calls.some(([, params]) => params?.[0] === 'twitter_consecutive_failures')).toBe(false);
  });

  it('still counts Twitter failures under twitter_consecutive_failures', async () => {
    renderPage.mockResolvedValueOnce({ markdown: null, reachable: false, reason: 'timeout' });
    const pool = { query: vi.fn(async () => ({ rows: [{ value: '1' }] })) };
    await collectTrailStatus(pool, { id: 5527, name: 'East Rim', status_url: 'https://x.com/CVNPmtb' });
    const keys = pool.query.mock.calls.map(([, params]) => params?.[0]);
    expect(keys).toContain('twitter_consecutive_failures');
    expect(keys).not.toContain('facebook_consecutive_failures');
  });
});
