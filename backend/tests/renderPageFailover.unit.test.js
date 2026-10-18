/**
 * renderPage fails over between network routes when a site blocks one, and
 * records what worked (egressRoutes.js).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../services/contentExtractor.js', () => ({ extractPageContent: vi.fn() }));
// Every test host is public except internal.example and literal private addresses.
vi.mock('../utils/publicAddress.js', () => ({
  isPublicUrl: vi.fn(async (url) => !/internal\.example|\/\/(127\.|10\.)/.test(url))
}));

import { renderPage } from '../services/renderPage.js';
import { extractPageContent } from '../services/contentExtractor.js';
import { setEgressConfig, resetEgressConfig } from '../services/egressRoutes.js';

const savedResidential = process.env.RESIDENTIAL_PROXY;
const OK = { reachable: true, markdown: 'Events listing '.repeat(200), title: 'Events', links: [] };
const CLOSED = { reachable: false, reason: 'page.goto: net::ERR_CONNECTION_CLOSED at https://x' };

// The IPRoyal reservation returns a row only while today's count is under the cap.
function fakePool({ residentialToday = 0, cap = 5 } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("VALUES (CURRENT_DATE, 'residential', 1)")) return { rows: residentialToday < cap ? [{ renders: residentialToday + 1 }] : [] };
      return { rows: [] };
    })
  };
}
const routesTried = () => extractPageContent.mock.calls.map(([, opts]) => opts.egress);

afterEach(() => {
  extractPageContent.mockReset();
  resetEgressConfig();
  if (savedResidential === undefined) delete process.env.RESIDENTIAL_PROXY;
  else process.env.RESIDENTIAL_PROXY = savedResidential;
});

describe('renderPage network failover', () => {
  it('falls through to no proxy when ExpressVPN is blocked, and learns it', async () => {
    setEgressConfig();
    extractPageContent.mockResolvedValueOnce(CLOSED).mockResolvedValueOnce(OK);
    const pool = fakePool();

    const page = await renderPage(pool, 'https://www.newfranklin.org/1222/Community-Events', {});

    expect(page.reachable).toBe(true);
    expect(routesTried()).toEqual(['expressvpn', 'direct']);
    const learned = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO egress_domain_routes'));
    expect(learned[1].slice(0, 2)).toEqual(['newfranklin.org', 'direct']);
  });

  it('reaches IPRoyal last, only when it is configured and under the cap', async () => {
    setEgressConfig({ cap: 5 });
    process.env.RESIDENTIAL_PROXY = 'http://u:p@geo.example.com:12321';
    extractPageContent.mockResolvedValueOnce(CLOSED).mockResolvedValueOnce(CLOSED).mockResolvedValueOnce(OK);
    expect((await renderPage(fakePool(), 'https://www.cvsr.org/excursions', {})).reachable).toBe(true);
    expect(routesTried()).toEqual(['expressvpn', 'direct', 'residential']);

    extractPageContent.mockReset();
    extractPageContent.mockResolvedValue(CLOSED);
    setEgressConfig({ cap: 5 }); // learning the route above invalidated the cache
    const capped = await renderPage(fakePool({ residentialToday: 5 }), 'https://www.cvsr.org/about', {});
    expect(capped.reachable).toBe(false);
    expect(routesTried()).toEqual(['expressvpn', 'direct']);
  });

  it('returns the last blocked render and flags the domain when every route is blocked', async () => {
    setEgressConfig({ cap: 5 });
    process.env.RESIDENTIAL_PROXY = 'http://u:p@geo.example.com:12321';
    extractPageContent.mockResolvedValue(CLOSED);
    const pool = fakePool();

    const page = await renderPage(pool, 'https://www.wrhs.org/', {});

    expect(page).toEqual(CLOSED);
    expect(routesTried()).toEqual(['expressvpn', 'direct', 'residential']);
    const flagged = pool.query.mock.calls.find(([sql]) => sql.includes('last_blocked_at = NOW()'));
    expect(flagged[1][0]).toBe('wrhs.org');
    expect(flagged[1][2]).toMatch(/^expressvpn: .*ERR_CONNECTION_CLOSED.*; direct: .*; residential: /);
  });

  it('never fails over to the direct route for a non-public address', async () => {
    setEgressConfig();
    extractPageContent.mockResolvedValue({ reachable: false, reason: 'page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at http://127.0.0.1:8019/' });
    const pool = fakePool();

    const page = await renderPage(pool, 'http://127.0.0.1:8019/health', {});

    expect(page.reachable).toBe(false);
    expect(routesTried()).toEqual(['expressvpn']);
    expect(page.reason).toMatch(/ERR_TUNNEL_CONNECTION_FAILED/);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('egress_domain_routes'))).toBe(false);
  });

  it('treats a WAF block page as blocked and fails over', async () => {
    setEgressConfig();
    const blockPage = { reachable: true, title: 'Attention Required! | Cloudflare', links: [], markdown: 'Sorry, you have been blocked' };
    extractPageContent.mockResolvedValueOnce(blockPage).mockResolvedValueOnce(OK);
    expect((await renderPage(fakePool(), 'https://botzum.org/history', {})).reachable).toBe(true);
    expect(routesTried()).toEqual(['expressvpn', 'direct']);
  });

  it('does not fail over on an ordinary failure, or from a pinned route', async () => {
    setEgressConfig({ entries: { 'newfranklin.org': { route: 'direct', source: 'manual', updatedAt: 0 } } });
    extractPageContent.mockResolvedValue({ reachable: false, reason: 'page.goto: net::ERR_NAME_NOT_RESOLVED' });
    await renderPage(fakePool(), 'https://gone.example.org/', {});
    expect(routesTried()).toEqual(['expressvpn']);

    extractPageContent.mockReset();
    extractPageContent.mockResolvedValue(CLOSED);
    const pool = fakePool();
    await renderPage(pool, 'https://newfranklin.org/1222', {});
    expect(routesTried()).toEqual(['direct']);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('last_blocked_at = NOW()'))).toBe(true);
  });
});
