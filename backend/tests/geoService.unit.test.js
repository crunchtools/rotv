import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getContainingBoundaries, getReassignmentCandidates, getRollupPoiIds } from '../services/geoService.js';

// Route each query to a responder by a distinctive SQL fragment. A responder is
// either an array of rows or an Error (which the pool rejects with).
function routedPool(routes) {
  const query = vi.fn(async (sql) => {
    const match = Object.keys(routes).find(fragment => sql.includes(fragment));
    if (!match) throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    const outcome = routes[match];
    if (outcome instanceof Error) throw outcome;
    return { rows: outcome };
  });
  return { query };
}

const TARGET = 'has_boundary';
const OWNED = 'poi_associations';
const CONTAINED = 'WITH boundaries AS';
const OWNER = 'JOIN pois o ON o.id = x.owner_id';
const BOUNDARY_CANDIDATE = 'LIMIT 1';

let warnSpy;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getContainingBoundaries', () => {
  it('returns names smallest-first, dropping the null row a LEFT JOIN miss produces', async () => {
    const pool = routedPool({ 'LEFT JOIN pois AS boundary': [{ name: 'Hampton Hills' }, { name: null }, { name: 'Summit County' }] });

    await expect(getContainingBoundaries(pool, 5)).resolves.toEqual(['Hampton Hills', 'Summit County']);
    expect(pool.query.mock.calls[0][1]).toEqual([5]);
  });

  it('returns [] when the query succeeds with no rows', async () => {
    const pool = routedPool({ 'LEFT JOIN pois AS boundary': [] });
    await expect(getContainingBoundaries(pool, 5)).resolves.toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns [] and logs a warning when PostGIS fails', async () => {
    const pool = routedPool({ 'LEFT JOIN pois AS boundary': new Error('function st_contains does not exist') });

    await expect(getContainingBoundaries(pool, 5)).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[Geo] Boundary lookup unavailable for POI 5: function st_contains does not exist'
    );
  });
});

describe('getReassignmentCandidates', () => {
  it('returns owner and boundary when both lookups find a row', async () => {
    const pool = routedPool({
      [OWNER]: [{ id: 1, name: 'Cleveland Metroparks' }],
      [BOUNDARY_CANDIDATE]: [{ id: 2, name: 'Brecksville Reservation' }]
    });

    await expect(getReassignmentCandidates(pool, '40')).resolves.toEqual({
      owner: { id: 1, name: 'Cleveland Metroparks' },
      boundary: { id: 2, name: 'Brecksville Reservation' }
    });
    expect(pool.query.mock.calls.every(([, params]) => params[0] === 40)).toBe(true);
  });

  it('returns nulls for empty results', async () => {
    const pool = routedPool({ [OWNER]: [], [BOUNDARY_CANDIDATE]: [] });
    await expect(getReassignmentCandidates(pool, 40)).resolves.toEqual({ owner: null, boundary: null });
  });

  it('still runs the boundary lookup when the owner lookup fails', async () => {
    const pool = routedPool({
      [OWNER]: new Error('connection reset'),
      [BOUNDARY_CANDIDATE]: [{ id: 2, name: 'Brecksville Reservation' }]
    });

    await expect(getReassignmentCandidates(pool, 40)).resolves.toEqual({
      owner: null,
      boundary: { id: 2, name: 'Brecksville Reservation' }
    });
    expect(warnSpy).toHaveBeenCalledWith('[Geo] Owner lookup failed for POI 40: connection reset');
  });

  it('degrades a failed spatial lookup to a null boundary', async () => {
    const pool = routedPool({ [OWNER]: [{ id: 1, name: 'Org' }], [BOUNDARY_CANDIDATE]: new Error('postgis missing') });
    await expect(getReassignmentCandidates(pool, 40)).resolves.toEqual({ owner: { id: 1, name: 'Org' }, boundary: null });
  });

  it.each([0, -3, 'abc', null])('skips the database for invalid id %s', async (badId) => {
    const pool = routedPool({});
    await expect(getReassignmentCandidates(pool, badId)).resolves.toEqual({ owner: null, boundary: null });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('getRollupPoiIds', () => {
  it.each([0, -1, 'x', undefined])('returns [] for invalid id %s without querying', async (badId) => {
    const pool = routedPool({});
    await expect(getRollupPoiIds(pool, badId)).resolves.toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('falls back to [id] when the target lookup fails (null)', async () => {
    const pool = routedPool({ [TARGET]: new Error('db down') });
    await expect(getRollupPoiIds(pool, 7)).resolves.toEqual([7]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('returns [] for a POI that does not exist (empty rows, not null)', async () => {
    const pool = routedPool({ [TARGET]: [] });
    await expect(getRollupPoiIds(pool, 7)).resolves.toEqual([]);
  });

  it('returns just [id] for a point POI with no further queries', async () => {
    const pool = routedPool({ [TARGET]: [{ poi_roles: ['point'], has_boundary: false }] });
    await expect(getRollupPoiIds(pool, 7)).resolves.toEqual([7]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('treats null poi_roles as no roles', async () => {
    const pool = routedPool({ [TARGET]: [{ poi_roles: null, has_boundary: true }] });
    await expect(getRollupPoiIds(pool, 7)).resolves.toEqual([7]);
  });

  it('does not run containment for a boundary role without a polygon', async () => {
    const pool = routedPool({ [TARGET]: [{ poi_roles: ['boundary'], has_boundary: false }] });
    await expect(getRollupPoiIds(pool, 7)).resolves.toEqual([7]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('adds contained POIs for a boundary, de-duplicated and integer-only', async () => {
    const pool = routedPool({
      [TARGET]: [{ poi_roles: ['boundary'], has_boundary: true }],
      [CONTAINED]: [{ id: 11 }, { id: 12 }, { id: 7 }, { id: '13' }]
    });

    await expect(getRollupPoiIds(pool, 7)).resolves.toEqual([7, 11, 12]);
    const containmentCall = pool.query.mock.calls.find(([sql]) => sql.includes(CONTAINED));
    expect(containmentCall[1]).toEqual([[7]]);
  });

  it('keeps [id] when boundary containment fails', async () => {
    const pool = routedPool({
      [TARGET]: [{ poi_roles: ['boundary'], has_boundary: true }],
      [CONTAINED]: new Error('st_contains failed')
    });
    await expect(getRollupPoiIds(pool, 7)).resolves.toEqual([7]);
    expect(warnSpy).toHaveBeenCalledWith('[Geo] Containment rollup unavailable for POI 7: st_contains failed');
  });

  it('expands an organization through owned POIs, then through their boundaries', async () => {
    const pool = routedPool({
      [TARGET]: [{ poi_roles: ['organization'], has_boundary: false }],
      [OWNED]: [{ id: 20 }, { id: 21 }, { id: null }],
      [CONTAINED]: [{ id: 30 }, { id: 21 }]
    });

    await expect(getRollupPoiIds(pool, 1)).resolves.toEqual([1, 20, 21, 30]);
    const containmentCall = pool.query.mock.calls.find(([sql]) => sql.includes(CONTAINED));
    expect(containmentCall[1]).toEqual([[20, 21]]);
  });

  it('keeps owned POIs when org containment fails', async () => {
    const pool = routedPool({
      [TARGET]: [{ poi_roles: ['organization'], has_boundary: false }],
      [OWNED]: [{ id: 20 }],
      [CONTAINED]: new Error('postgis down')
    });
    await expect(getRollupPoiIds(pool, 1)).resolves.toEqual([1, 20]);
  });

  it('skips containment for an org whose ownership lookup fails or is empty', async () => {
    const failing = routedPool({
      [TARGET]: [{ poi_roles: ['organization'], has_boundary: false }],
      [OWNED]: new Error('timeout')
    });
    await expect(getRollupPoiIds(failing, 1)).resolves.toEqual([1]);
    expect(failing.query).toHaveBeenCalledTimes(2);

    const empty = routedPool({
      [TARGET]: [{ poi_roles: ['organization'], has_boundary: false }],
      [OWNED]: []
    });
    await expect(getRollupPoiIds(empty, 1)).resolves.toEqual([1]);
    expect(empty.query).toHaveBeenCalledTimes(2);
  });

  it('includes its own polygon and owned boundaries for an org that is also a boundary', async () => {
    const pool = routedPool({
      [TARGET]: [{ poi_roles: ['organization', 'boundary'], has_boundary: true }],
      [OWNED]: [{ id: 20 }],
      [CONTAINED]: [{ id: 40 }]
    });

    await expect(getRollupPoiIds(pool, 1)).resolves.toEqual([1, 20, 40]);
    const containmentCall = pool.query.mock.calls.find(([sql]) => sql.includes(CONTAINED));
    expect(containmentCall[1]).toEqual([[1, 20]]);
  });
});
