import { describe, it, expect, vi } from 'vitest';
import { backfillImageServerPrimaries } from '../services/imageServerBackfill.js';

const mockPool = () => ({
  query: vi.fn()
    .mockResolvedValueOnce({ rowCount: 1, rows: [] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: 4 }] })
});

describe('backfillImageServerPrimaries (#770)', () => {
  it('does nothing when the image server is not configured', async () => {
    const pool = mockPool();
    const client = { initialized: false, listAllAssets: vi.fn() };

    expect(await backfillImageServerPrimaries(pool, client)).toBeNull();
    expect(client.listAllAssets).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('offers only primary images and videos that belong to a place', async () => {
    const pool = mockPool();
    const client = {
      initialized: true,
      listAllAssets: vi.fn().mockResolvedValue([
        { id: 1, poi_id: 10, role: 'primary', asset_type: 'image' },
        { id: 2, poi_id: 11, role: 'primary', asset_type: 'video' },
        { id: 3, poi_id: 12, role: 'gallery', asset_type: 'image' },
        { id: 4, poi_id: null, role: 'primary', asset_type: 'image' },
        { id: 5, poi_id: 13, role: 'theme_video', asset_type: 'video' }
      ])
    };

    expect(await backfillImageServerPrimaries(pool, client))
      .toEqual({ assets: 2, inserted: 1, staleFlags: 4 });
    expect(pool.query.mock.calls[0][1]).toEqual([[10, 11], ['1', '2'], ['image', 'video']]);
  });
});
