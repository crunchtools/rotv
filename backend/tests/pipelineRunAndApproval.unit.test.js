import { describe, it, expect, vi } from 'vitest';
import { recordPipelineRun } from '../services/newsService.js';
import { approveItem, rejectItem } from '../services/moderationService.js';

describe('recordPipelineRun (issue #891)', () => {
  it('leaves current-news cadence alone when the search failed', async () => {
    const pool = { query: vi.fn() };
    await recordPipelineRun(pool, 'current_news', { id: 1 }, { searchFailed: true });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('leaves history_dry_runs alone when the search failed', async () => {
    const pool = { query: vi.fn() };
    await recordPipelineRun(pool, 'historical_news', { id: 1 }, { freshUrlCount: 0, searchFailed: true });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('still records a successful current-news run', async () => {
    const pool = { query: vi.fn() };
    await recordPipelineRun(pool, 'current_news', { id: 1 }, { searchFailed: false });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('approve/reject mark the item processed (issue #891)', () => {
  it('approveItem sets moderation_processed so the worker skips it', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await approveItem(pool, 'news', 5, 9);
    expect(pool.query.mock.calls[0][0]).toMatch(/moderation_processed = true/);
  });

  it('rejectItem sets moderation_processed', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await rejectItem(pool, 'news', 5, 9, 'nope');
    expect(pool.query.mock.calls[0][0]).toMatch(/moderation_processed = true/);
  });
});
