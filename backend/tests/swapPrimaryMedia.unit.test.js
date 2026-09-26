import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { swapPrimaryMedia } from '../routes/admin.js';

// A pool whose connect() hands out one recording client. `failOn` names the first
// statement keyword (BEGIN, DELETE, INSERT, COMMIT, ROLLBACK) that should reject.
function fakePool({ failOn = {} } = {}) {
  const statements = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      const keyword = sql.trim().split(/\s+/)[0];
      statements.push({ keyword, params });
      if (failOn[keyword]) throw failOn[keyword];
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(() => statements.push({ keyword: 'release' }))
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(() => { throw new Error('pool.query must not be used; the swap needs one client'); })
  };
  return { pool, client, statements, keywords: () => statements.map(s => s.keyword) };
}

let warnSpy;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('swapPrimaryMedia', () => {
  it('runs BEGIN, DELETE, INSERT, COMMIT on one checked-out client, then releases it', async () => {
    const { pool, client, statements, keywords } = fakePool();

    await swapPrimaryMedia(pool, 42, 'asset-9', 3);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
    expect(keywords()).toEqual(['BEGIN', 'DELETE', 'INSERT', 'COMMIT', 'release']);
    expect(client.release).toHaveBeenCalledTimes(1);

    const [, del, ins] = statements;
    expect(del.params).toEqual([42]);
    expect(ins.params).toEqual([42, 'asset-9', 3]);
  });

  it('deletes only the primary row and inserts an auto-approved primary image', async () => {
    const { pool, client } = fakePool();

    await swapPrimaryMedia(pool, 42, 'asset-9', 3);

    const [deleteSql] = client.query.mock.calls[1];
    const [insertSql] = client.query.mock.calls[2];
    expect(deleteSql).toMatch(/DELETE FROM poi_media WHERE poi_id = \$1 AND role = 'primary'/);
    expect(insertSql).toMatch(/INSERT INTO poi_media/);
    expect(insertSql).toMatch(/'image', \$2, 'primary', 'auto_approved', \$3/);
  });

  it('rolls back, releases, and rethrows the original error when INSERT fails', async () => {
    const insertError = new Error('duplicate key');
    const { pool, client, keywords } = fakePool({ failOn: { INSERT: insertError } });

    await expect(swapPrimaryMedia(pool, 42, 'asset-9', 3)).rejects.toBe(insertError);

    expect(keywords()).toEqual(['BEGIN', 'DELETE', 'INSERT', 'ROLLBACK', 'release']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back without inserting when DELETE fails', async () => {
    const deleteError = new Error('lock timeout');
    const { pool, keywords } = fakePool({ failOn: { DELETE: deleteError } });

    await expect(swapPrimaryMedia(pool, 42, 'asset-9', 3)).rejects.toBe(deleteError);

    expect(keywords()).toEqual(['BEGIN', 'DELETE', 'ROLLBACK', 'release']);
  });

  it('rolls back, releases and rethrows without running DELETE or INSERT when BEGIN fails', async () => {
    const beginError = new Error('cannot begin');
    const { pool, client, keywords } = fakePool({ failOn: { BEGIN: beginError } });

    await expect(swapPrimaryMedia(pool, 42, 'asset-9', 3)).rejects.toBe(beginError);

    expect(keywords()).toEqual(['BEGIN', 'ROLLBACK', 'release']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back when COMMIT itself fails', async () => {
    const commitError = new Error('serialization failure');
    const { pool, keywords } = fakePool({ failOn: { COMMIT: commitError } });

    await expect(swapPrimaryMedia(pool, 42, 'asset-9', 3)).rejects.toBe(commitError);

    expect(keywords()).toEqual(['BEGIN', 'DELETE', 'INSERT', 'COMMIT', 'ROLLBACK', 'release']);
  });

  it('rethrows the original error, not the ROLLBACK error, and still releases', async () => {
    const insertError = new Error('duplicate key');
    const { pool, client } = fakePool({
      failOn: { INSERT: insertError, ROLLBACK: new Error('connection terminated') }
    });

    await expect(swapPrimaryMedia(pool, 42, 'asset-9', 3)).rejects.toBe(insertError);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[Admin] ROLLBACK failed after primary media swap error:', 'connection terminated'
    );
  });

  it('propagates a connect() failure unchanged', async () => {
    const connectError = new Error('pool exhausted');
    const pool = { connect: vi.fn().mockRejectedValue(connectError) };

    await expect(swapPrimaryMedia(pool, 42, 'asset-9', 3)).rejects.toBe(connectError);
  });
});
