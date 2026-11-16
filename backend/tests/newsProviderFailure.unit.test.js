/**
 * #888: with OpenRouter out of credits, every page classification throws inside
 * runConcurrent and the crawl returns nothing. collectPoi must still log that
 * failure with its error_class, which is what /api/health/collection reads.
 */
import { describe, it, expect, vi } from 'vitest';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock('../services/jobLogger.js', () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError, flush: vi.fn() }));
vi.mock('../services/browserPool.js', () => ({ healthCheck: vi.fn().mockResolvedValue(true), forceKill: vi.fn() }));
vi.mock('../services/renderPage.js', () => ({
  renderPage: vi.fn().mockResolvedValue({ reachable: true, markdown: 'Park news. '.repeat(40), links: [] }),
  setCachePageType: vi.fn(),
  setCacheItemCount: vi.fn()
}));
vi.mock('../services/llmService.js', () => ({
  generateTextWithCustomPrompt: vi.fn().mockRejectedValue(
    new Error('OpenRouter returned 402: {"error":{"code":402,"message":"Insufficient credits"}}')
  )
}));

const { collectPoi } = await import('../services/newsService.js');

describe('collectPoi with OpenRouter out of credits', () => {
  it('logs the credit failure with its class instead of ending with silent zero results', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const poi = { id: 7, name: 'Test Falls', poi_roles: ['point'], news_url: 'https://example.org/news' };

    const result = await collectPoi(pool, poi, null, 'America/New_York', 'news', null, { skipPhaseTwo: true });

    expect(result.news).toEqual([]);
    expect(logError).toHaveBeenCalledWith(
      expect.anything(), 'news', 7, 'Test Falls',
      expect.stringContaining('Insufficient credits'),
      { provider: 'openrouter', error_class: 'quota_exhausted' }
    );
  });
});
