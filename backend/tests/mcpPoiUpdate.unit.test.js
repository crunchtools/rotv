/**
 * poi_update (#709): an agent corrects a POI's descriptions without SQL.
 * Column names come from the allowlist, never from argument keys.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const { buildPoiUpdate, POI_UPDATE_FIELDS } = await import('../services/mcpServer.js');

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
    const update = buildPoiUpdate(1, { name: 'Renamed', 'id = 1; DROP TABLE pois; --': 'x', surface: 'gravel' });
    expect(update.columns).toEqual(['surface']);
    expect(update.sql).not.toMatch(/name =|DROP/);
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
});
