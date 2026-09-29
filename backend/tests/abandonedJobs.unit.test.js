import { describe, it, expect, vi } from 'vitest';
import { cancelJob } from '../services/trailStatusService.js';

const mockPool = (rows) => ({ query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) });

describe('trail cancelJob (#586)', () => {
  it.each([
    ['admin@example.com', 'Cancelled by admin@example.com'],
    [null, 'Cancelled'],
    [undefined, 'Cancelled']
  ])('records the actor %s as "%s"', async (actor, message) => {
    const pool = mockPool([{ id: 7 }]);

    expect(await cancelJob(pool, 7, actor)).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([7, message]);
  });

  it('returns false when no queued/running job matched', async () => {
    expect(await cancelJob(mockPool([]), 7, 'admin@example.com')).toBe(false);
  });
});
