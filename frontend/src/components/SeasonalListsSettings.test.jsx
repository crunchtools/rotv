import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import SeasonalListsSettings from './SeasonalListsSettings';

const draft = {
  id: 9, series: 'fall-hiking-spree', edition: 2027, name: 'Fall Hiking Spree', status: 'draft',
  starts_on: '2027-09-01', ends_on: '2027-11-30',
  refresh_report: {
    field: 'FHS_2027', basedOn: 2026, newTrails: [], dropped: ['Downy Loop Trail'], changed: [], incomplete: [],
    unparsed: [], todo: ['Add this year\'s banner picture.'],
    unmatched: [{ entry: 'Jogging Trail (Sand Run Metro Park, 3.5 miles, moderate)', districtName: 'Jogging Trail', candidates: [] }]
  },
  items: [{ id: 31, poi_id: 4, poi_name: 'Seneca Trail', position: 1, label: 'Seneca Trail', miles: 1.4, rating: 'Moderate' }]
};
const published = { ...draft, id: 1, edition: 2026, status: 'published', refresh_report: null };

function mockApi() {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
    const body =
      url === '/api/admin/lists' ? [draft, published] :
      url === '/api/admin/lists/trails' ? [{ id: 77, name: 'Jogging Trail' }] :
      url.endsWith('/publish') ? { ...draft, status: 'published' } :
      url.endsWith('/items') ? { ...draft, refresh_report: { ...draft.refresh_report, unmatched: [] } } : {};
    return { ok: true, json: async () => body };
  });
  return calls;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SeasonalListsSettings', () => {
  it('shows a draft with what the refresh found, and only a summary of a published list', async () => {
    mockApi();
    render(<SeasonalListsSettings />);

    expect(await screen.findByText('2027 Fall Hiking Spree · Draft')).toBeTruthy();
    expect(screen.getByText('Downy Loop Trail')).toBeTruthy();
    expect(screen.getByText(/Jogging Trail \(Sand Run Metro Park/)).toBeTruthy();
    expect(screen.getByText('2026 Fall Hiking Spree · Published')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Publish/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Check for the 2028 spree' })).toBeTruthy();
  });

  it('adds an unmatched entry by the trail picked, then publishes', async () => {
    const calls = mockApi();
    render(<SeasonalListsSettings />);
    await screen.findByText('2027 Fall Hiking Spree · Draft');
    await waitFor(() => expect(calls.some(c => c.url === '/api/admin/lists/trails')).toBe(true));

    fireEvent.change(screen.getByLabelText('Trail on the map'), { target: { value: 'Jogging Trail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to the list' }));
    await waitFor(() => expect(calls.find(c => c.url === '/api/admin/lists/9/items')).toBeTruthy());
    expect(calls.find(c => c.url === '/api/admin/lists/9/items').body).toMatchObject({ poi_id: 77, entry: draft.refresh_report.unmatched[0].entry });

    fireEvent.click(screen.getByRole('button', { name: 'Publish the 2027 spree' }));
    expect(await screen.findByText('The 2027 Fall Hiking Spree is published.')).toBeTruthy();
  });
});
