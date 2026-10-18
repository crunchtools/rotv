/**
 * Network Routes admin operations (egressAdmin.js), shared by the admin API and MCP.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getEgressOverview, setDomainRoute, setEgressSettings, EgressValidationError } from '../services/egressAdmin.js';

const savedResidential = process.env.RESIDENTIAL_PROXY;
afterEach(() => {
  if (savedResidential === undefined) delete process.env.RESIDENTIAL_PROXY;
  else process.env.RESIDENTIAL_PROXY = savedResidential;
});

const writes = () => ({ query: vi.fn(async () => ({ rows: [] })) });

describe('setDomainRoute', () => {
  it('pins a normalized domain as a manual route', async () => {
    const pool = writes();
    expect(await setDomainRoute(pool, 'https://www.CVSR.org/excursions', 'residential', 7))
      .toEqual({ domain: 'cvsr.org', route: 'residential' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO egress_domain_routes[\s\S]*source = 'manual'/);
    expect(params).toEqual(['cvsr.org', 'residential', 7]);
  });

  it('resets a domain to the default by deleting its entry', async () => {
    const pool = writes();
    await setDomainRoute(pool, 'newfranklin.org', 'default');
    expect(pool.query.mock.calls[0]).toEqual(['DELETE FROM egress_domain_routes WHERE domain = $1', ['newfranklin.org']]);
  });

  it('rejects bad domains and routes without touching the database', async () => {
    const pool = writes();
    await expect(setDomainRoute(pool, 'not a domain', 'direct')).rejects.toBeInstanceOf(EgressValidationError);
    await expect(setDomainRoute(pool, 'cvsr.org', 'tor')).rejects.toBeInstanceOf(EgressValidationError);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('setEgressSettings', () => {
  it('saves the default route and the IPRoyal cap', async () => {
    const pool = writes();
    await setEgressSettings(pool, { defaultRoute: 'direct', residentialCap: 0 }, 3);
    expect(pool.query.mock.calls.map(([, params]) => params)).toEqual([
      ['egress_default_route', 'direct', 3],
      ['egress_residential_daily_cap', '0', 3]
    ]);
  });

  it('rejects an unknown default or a cap out of range, before writing anything', async () => {
    const pool = writes();
    await expect(setEgressSettings(pool, { defaultRoute: 'tor' })).rejects.toBeInstanceOf(EgressValidationError);
    await expect(setEgressSettings(pool, { residentialCap: -1 })).rejects.toBeInstanceOf(EgressValidationError);
    await expect(setEgressSettings(pool, { residentialCap: 1.5 })).rejects.toBeInstanceOf(EgressValidationError);
    await expect(setEgressSettings(pool, { defaultRoute: 'direct', residentialCap: 100001 })).rejects.toBeInstanceOf(EgressValidationError);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('getEgressOverview', () => {
  it('reports settings, IPRoyal status, usage and camelCased routes', async () => {
    process.env.RESIDENTIAL_PROXY = 'http://u:p@geo.example.com:12321';
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('admin_settings')) return { rows: [{ key: 'egress_default_route', value: 'expressvpn' }, { key: 'egress_residential_daily_cap', value: '100' }] };
        if (sql.includes('egress_usage')) return { rows: [{ route: 'residential', today: 3, last30: 40 }] };
        return { rows: [{ domain: 'cvsr.org', route: 'residential', source: 'auto', last_ok_at: 'a', last_blocked_at: 'b', last_error: 'e', updated_at: 'u' }] };
      })
    };
    expect(await getEgressOverview(pool)).toEqual({
      defaultRoute: 'expressvpn',
      residentialConfigured: true,
      residentialCap: 100,
      estimatedMbPerRender: 0.6,
      usage: { residential: { today: 3, last30: 40 } },
      routes: [{ domain: 'cvsr.org', route: 'residential', source: 'auto', lastOkAt: 'a', lastBlockedAt: 'b', lastError: 'e', updatedAt: 'u' }]
    });
  });
});
