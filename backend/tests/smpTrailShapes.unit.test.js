/**
 * Redrawing short trails from Summit Metro Parks' lines (#778): a trail is
 * replaced only by the district's line for the same trail, on the same ground,
 * when ours is clearly short of it.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeName, lineMiles, shareOnLine, planShapeUpdates, fetchDistrictTrails, syncTrailShapes, SYNCED_SETTING
} from '../services/smpTrailShapes.js';

const MILE_NORTH = 1 / 69.05;
// A line north from a point, `miles` long, with a vertex every tenth of a mile.
const north = (lon, lat, miles) => ({
  type: 'LineString',
  coordinates: Array.from({ length: Math.round(miles * 10) + 1 }, (_, i) => [lon, lat + i * 0.1 * MILE_NORTH])
});
const feature = (NAME, geometry) => ({ type: 'Feature', properties: { NAME }, geometry });

describe('normalizeName', () => {
  it('compares names without case, punctuation or the park in brackets', () => {
    expect(normalizeName('Parcours Trail (Goodyear Heights)')).toBe(normalizeName('Parcours Trail'));
    expect(normalizeName("Miner's Trail")).toBe('minerstrail');
    expect(normalizeName('Towpath Trail ')).toBe('towpathtrail');
  });
});

describe('lineMiles and shareOnLine', () => {
  it('measures a line and how much of another lies on it', () => {
    expect(lineMiles(north(-81.57, 41.13, 2))).toBeCloseTo(2, 2);
    const whole = north(-81.57, 41.13, 2);
    expect(shareOnLine(north(-81.57, 41.13, 0.5), whole)).toBe(1);
    // Two kilometres east is another trail
    expect(shareOnLine(north(-81.546, 41.13, 0.5), whole)).toBe(0);
  });
});

describe('planShapeUpdates', () => {
  const district = [feature('Valley Link Trail', north(-81.57, 41.13, 2.8)), feature('Ledges Trail', north(-81.4, 41.33, 0.9))];

  it('redraws a trail that is short of the district\'s line for it', () => {
    const { updates } = planShapeUpdates([{ id: 1, name: 'Valley Link Trail', geometry: north(-81.57, 41.13, 0.3) }], district);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: 1, districtName: 'Valley Link Trail' });
    expect(updates[0].toMiles).toBeCloseTo(2.8, 1);
  });

  it('leaves a trail of the same name elsewhere alone, and reports the district\'s as not on the map', () => {
    const { updates, missing } = planShapeUpdates([{ id: 2, name: 'Ledges Trail', geometry: north(-81.51, 41.22, 0.5) }], district);
    expect(updates).toEqual([]);
    expect(missing).toEqual(['Valley Link Trail', 'Ledges Trail']);
  });

  it('leaves a trail within a tenth of the district\'s length alone', () => {
    const { updates } = planShapeUpdates([{ id: 3, name: 'Valley Link Trail', geometry: north(-81.57, 41.13, 2.6) }], district);
    expect(updates).toEqual([]);
  });
});

describe('fetchDistrictTrails', () => {
  it('refuses a partial layer rather than redraw from half of it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [], exceededTransferLimit: true }) });
    await expect(fetchDistrictTrails(fetchImpl)).rejects.toThrow(/only part/);
  });
});

describe('syncTrailShapes', () => {
  const district = { features: [feature('Spring Hollow Trail', north(-81.57, 41.13, 1.8))] };
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => district });
  const ours = { id: 7, name: 'Spring Hollow Trail', geometry: north(-81.57, 41.13, 0.3) };

  it('writes the new line only over the one it read, and records the run', async () => {
    const query = vi.fn(async (sql) => (sql.startsWith('SELECT') ? { rows: [ours] } : { rowCount: 1 }));
    const result = await syncTrailShapes({ query }, { fetchImpl });

    expect(result.updated).toEqual([expect.objectContaining({ id: 7, fromMiles: 0.3, toMiles: 1.8 })]);
    const update = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE pois'));
    expect(update[1][0]).toBe(7);
    expect(update[1][2]).toBe(JSON.stringify(ours.geometry));
    expect(query.mock.calls.some(([sql, params]) => sql.includes('admin_settings') && params[0] === SYNCED_SETTING)).toBe(true);
  });

  it('reports without writing on a dry run', async () => {
    const query = vi.fn(async () => ({ rows: [ours] }));
    const result = await syncTrailShapes({ query }, { fetchImpl, dryRun: true });

    expect(result.updated).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
