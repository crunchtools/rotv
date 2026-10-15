/**
 * The job logger keeps every entry it is given storable: job_logs refuses a
 * name over 255 characters and the NUL character, and one refused entry used to
 * lose the whole batch flushed with it.
 */
import { describe, it, expect, vi } from 'vitest';
import { initJobLogger, log, flush, stopJobLogger } from '../services/jobLogger.js';

describe('jobLogger', () => {
  it('cuts a long title to the column and drops NUL characters, keeping the rest of the batch', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 2 });
    initJobLogger({ query });

    log({ jobId: 7, jobType: 'moderation', poiName: 'A'.repeat(400), message: 'Rescoring news #1' });
    log({ jobId: 7, jobType: 'moderation', poiName: 'Page\u0000 title', message: 'body\u0000 text', details: { excerpt: ['x\u0000y'], 'k\u0000ey': 1, at: new Date('2026-10-15T10:18:00Z') } });
    await flush();
    await stopJobLogger();

    const [, values] = query.mock.calls[0];
    expect(values).toHaveLength(14);
    expect(values[3]).toHaveLength(255);
    expect(values[3].endsWith('…')).toBe(true);
    expect(values[10]).toBe('Page title');
    expect(values[12]).toBe('body text');
    expect(values[13]).toEqual({ excerpt: ['xy'], key: 1, at: '2026-10-15T10:18:00.000Z' });
  });

  it('passes clean details through as they are', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    initJobLogger({ query });
    const details = { completed: true, counts: [1, 2] };

    log({ jobId: 8, jobType: 'news', message: 'done', details });
    await flush();
    await stopJobLogger();

    expect(query.mock.calls[0][1][6]).toBe(details);
  });
});
