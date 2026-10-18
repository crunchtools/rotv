import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import NetworkRoutesSettings from './NetworkRoutesSettings';

const overview = {
  defaultRoute: 'expressvpn',
  residentialConfigured: true,
  residentialCap: 100,
  estimatedMbPerRender: 0.6,
  usage: { residential: { today: 3, last30: 40 } },
  routes: [
    { domain: 'newfranklin.org', route: 'direct', source: 'manual', lastOkAt: '2026-10-18T17:50:57Z', lastBlockedAt: null, lastError: null },
    { domain: 'cvsr.org', route: 'residential', source: 'auto', lastOkAt: null, lastBlockedAt: '2026-10-18T08:31:00Z', lastError: 'expressvpn: ERR_CONNECTION_CLOSED' }
  ]
};

function mockApi() {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
    return { ok: true, json: async () => overview };
  });
  return calls;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('NetworkRoutesSettings', () => {
  it('shows the default, IPRoyal usage, and each domain with how its route was set', async () => {
    mockApi();
    render(<NetworkRoutesSettings />);

    expect(await screen.findByText('newfranklin.org')).toBeTruthy();
    expect(screen.getByLabelText('Default route').value).toBe('expressvpn');
    expect(screen.getByText(/Today 3 of 100 renders; last 30 days 40 renders \(about 24 MB\)/)).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('Auto')).toBeTruthy();
    expect(screen.getByText('expressvpn: ERR_CONNECTION_CLOSED')).toBeTruthy();
    expect(screen.getByLabelText('Route for cvsr.org').value).toBe('residential');
  });

  it('pins a domain, adds one, resets one, and changes the default', async () => {
    const calls = mockApi();
    render(<NetworkRoutesSettings />);
    await screen.findByText('newfranklin.org');

    fireEvent.change(screen.getByLabelText('Route for cvsr.org'), { target: { value: 'direct' } });
    await waitFor(() => expect(calls.find(c => c.method === 'PUT' && c.url === '/api/admin/egress/routes/cvsr.org')?.body).toEqual({ route: 'direct' }));

    fireEvent.change(screen.getByLabelText('New domain'), { target: { value: 'canalwaypartners.com' } });
    fireEvent.click(screen.getByText('Add domain'));
    await waitFor(() => expect(calls.find(c => c.url === '/api/admin/egress/routes/canalwaypartners.com')?.body).toEqual({ route: 'direct' }));

    fireEvent.click(screen.getAllByText('Reset')[0]);
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/admin/egress/routes/newfranklin.org')).toBe(true));

    fireEvent.change(screen.getByLabelText('Default route'), { target: { value: 'direct' } });
    await waitFor(() => expect(calls.find(c => c.url === '/api/admin/egress/settings')?.body).toEqual({ defaultRoute: 'direct' }));
  });
});
