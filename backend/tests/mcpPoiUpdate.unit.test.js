/**
 * poi_update (#709): an agent corrects a POI's descriptions without SQL.
 * Column names come from the allowlist, never from argument keys.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

const { buildPoiUpdate, POI_UPDATE_FIELDS, checkPoiRename } = await import('../services/mcpServer.js');

describe('buildPoiUpdate', () => {
  it('updates only the fields passed, in allowlist order', () => {
    const update = buildPoiUpdate(5846, { historical_description: 'Marina history', brief_description: 'A marina' });
    expect(update.columns).toEqual(['brief_description', 'historical_description']);
    expect(update.values).toEqual([5846, 'A marina', 'Marina history']);
    expect(update.sql).toMatch(/SET brief_description = \$2, historical_description = \$3, updated_at/);
    expect(update.sql).toMatch(/WHERE id = \$1 AND \(deleted IS NULL OR deleted = FALSE\)/);
  });

  it('passes null through so a field can be cleared', () => {
    const update = buildPoiUpdate(1, { historical_description: null });
    expect(update.values).toEqual([1, null]);
  });

  it('ignores keys outside the allowlist', () => {
    const update = buildPoiUpdate(1, { 'id = 1; DROP TABLE pois; --': 'x', surface: 'gravel' });
    expect(update.columns).toEqual(['surface']);
    expect(update.sql).not.toMatch(/DROP/);
  });

  it('renames a POI through the name column (#887)', () => {
    const update = buildPoiUpdate(1056, { name: 'Nature Play Area' });
    expect(update.columns).toEqual(['name']);
    expect(update.values).toEqual([1056, 'Nature Play Area']);
  });

  it('returns null when nothing would change', () => {
    expect(buildPoiUpdate(1, {})).toBeNull();
  });
});

describe('POI_UPDATE_FIELDS schema', () => {
  const schema = z.object(POI_UPDATE_FIELDS).strict();

  it('accepts nulls and valid enums', () => {
    expect(schema.safeParse({ brief_description: null, wheelchair: 'limited', fee: 'no' }).success).toBe(true);
  });

  it('rejects values the database constraints would refuse', () => {
    expect(schema.safeParse({ wheelchair: 'sometimes' }).success).toBe(false);
    expect(schema.safeParse({ cell_signal: 9 }).success).toBe(false);
    expect(schema.safeParse({ more_info_link: 'not a url' }).success).toBe(false);
  });

  it('trims name and rejects empty, null or over-long names (#887)', () => {
    expect(schema.parse({ name: '  Nature Play Area ' }).name).toBe('Nature Play Area');
    expect(schema.safeParse({ name: '   ' }).success).toBe(false);
    expect(schema.safeParse({ name: '' }).success).toBe(false);
    expect(schema.safeParse({ name: null }).success).toBe(false);
    expect(schema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('checkPoiRename', () => {
  const poolWith = (...results) => {
    const query = vi.fn();
    results.forEach(rows => query.mockResolvedValueOnce({ rows }));
    return { query };
  };

  it('allows a rename to a free name', async () => {
    const pool = poolWith([{ name: 'Nature PLay Area' }], []);
    expect(await checkPoiRename(pool, 1056, 'Nature Play Area')).toEqual({ error: null, oldName: 'Nature PLay Area' });
  });

  it('refuses a name another live POI holds', async () => {
    const pool = poolWith([{ name: 'Old Name' }], [{ id: 7, name: 'Taken Place' }]);
    expect((await checkPoiRename(pool, 1056, 'Taken Place')).error).toMatch(/Taken Place.*#7/);
  });

  it('reports a missing POI', async () => {
    const pool = poolWith([]);
    expect((await checkPoiRename(pool, 999, 'Anything')).error).toBe('POI #999 not found');
  });
});
