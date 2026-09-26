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

    expect(fetchFacebookPosts).toHaveBeenCalledWith('https://www.facebook.com/medinaTRAILS/');
    expect(renderPage).not.toHaveBeenCalled();
    expect(result).toEqual({ statusFound: 1, statusSaved: 0, skipped: true });
  });
});
