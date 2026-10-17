import { describe, it, expect, vi } from 'vitest';
import { reconcilePrimaryImageFlags } from '../services/primaryImageFlags.js';

const log = { warn: vi.fn() };

function fakePool(bareIds) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SET has_primary_image = true')) return { rowCount: 2 };
      if (sql.startsWith('SELECT')) return { rows: bareIds.map(id => ({ id })) };
      return { rowCount: params[0].length };
    }),
  };
}

describe('reconcilePrimaryImageFlags (#770)', () => {
  it('clears flags only where the image server has no asset', async () => {
    const pool = fakePool([1, 2, 3]);
    const client = { initialized: true, getPrimaryAsset: vi.fn(async id => (id === 2 ? { id: 'a' } : null)) };
    const result = await reconcilePrimaryImageFlags(pool, client, log);
    expect(result).toEqual({ raised: 2, cleared: 2, kept: 1, skipped: false });
    expect(pool.calls.at(-1).params[0]).toEqual([1, 3]);
  });

  it('clears nothing when the image server looks down', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const pool = fakePool(ids);
    const client = { initialized: true, getPrimaryAsset: vi.fn(async () => null) };
    const result = await reconcilePrimaryImageFlags(pool, client, log);
    expect(result.skipped).toBe(true);
    expect(result.cleared).toBe(0);
  });

  it('only raises flags without an image server', async () => {
    const pool = fakePool([1]);
    const result = await reconcilePrimaryImageFlags(pool, { initialized: false }, log);
    expect(result).toEqual({ raised: 2, cleared: 0, kept: 0, skipped: false });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
