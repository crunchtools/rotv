import { describe, it, expect, vi } from 'vitest';
import { failAbandonedJobs as failAbandonedNewsJobs } from '../services/newsService.js';
import { failAbandonedJobs as failAbandonedTrailJobs, cancelJob } from '../services/trailStatusService.js';

const mockPool = (rows) => ({ query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) });

describe('failAbandonedJobs (#586)', () => {
  it.each([
    ['news', failAbandonedNewsJobs, 'news_job_status'],
    ['trail status', failAbandonedTrailJobs, 'trail_status_job_status']
  ])('%s: fails only open jobs older than the resume window and returns their ids', async (_label, fn, table) => {
    const pool = mockPool([{ id: 452 }, { id: 453 }]);

    const ids = await fn(pool);

    expect(ids).toEqual([452, 453]);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain(`UPDATE ${table}`);
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain('error_message');
    expect(sql).toContain("status IN ('queued', 'running')");
    expect(sql).toContain("created_at <= NOW() - INTERVAL '1 hour'");
  });

  it('returns an empty list when nothing was abandoned', async () => {
    expect(await failAbandonedNewsJobs(mockPool([]))).toEqual([]);
  });
});

describe('trail cancelJob', () => {
  it('records who cancelled the job', async () => {
    const pool = mockPool([{ id: 7 }]);

    expect(await cancelJob(pool, 7, 'admin@example.com')).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([7, 'Cancelled by admin@example.com']);
  });
});
