import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../hooks/useModeration', () => ({ default: () => ({ pois: [], notify: vi.fn() }) }));
vi.mock('./NewsEventsShared', () => ({ EventCardBody: ({ item }) => <div className="park-event-item">{item.title}</div> }));
vi.mock('./ContentFormModal', () => ({ default: () => null }));
vi.mock('./ModerationExtras', () => ({ default: () => null }));

const { default: ParkEvents } = await import('./ParkEvents');

const event = (id, title) => ({ id, title, start_date: '2026-10-17T14:00:00Z', poi_name: 'Brandywine Falls' });

// Answers each events route with the given body; `null` leaves the request hanging.
function mockEvents({ today = [], weekend = [], future = [], past = [] }) {
  const calls = [];
  globalThis.fetch = vi.fn((url) => {
    calls.push(url);
    const body =
      url.includes('range=today') ? today && { count: today.length, events: today } :
      url.includes('range=weekend') ? weekend && { count: weekend.length, events: weekend } :
      url.includes('/upcoming') ? future :
      url.includes('/past') ? past : [];
    if (body === null) return new Promise(() => {});
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  return calls;
}

const dateButton = () => screen.getByRole('button', { name: /^Event dates: / });

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ParkEvents date menu', () => {
  it('opens on Today and lists today\'s events', async () => {
    mockEvents({ today: [event(1, 'Fall Color Hike')], weekend: [event(2, 'Weekend Walk')] });
    render(<ParkEvents refreshTrigger={0} />);

    expect(await screen.findByText('Fall Color Hike')).toBeTruthy();
    expect(dateButton().getAttribute('aria-label')).toBe('Event dates: Today');
    expect(screen.queryByText('Weekend Walk')).toBeNull();
  });

  it('falls back to This Weekend when nothing is on today', async () => {
    mockEvents({ today: [], weekend: [event(2, 'Weekend Walk')] });
    render(<ParkEvents refreshTrigger={0} />);

    expect(await screen.findByText('Weekend Walk')).toBeTruthy();
    expect(dateButton().getAttribute('aria-label')).toBe('Event dates: This Weekend');
  });

  it('fetches past events only when Past is picked', async () => {
    const calls = mockEvents({ today: [event(1, 'Fall Color Hike')], past: [event(3, 'Summer Concert')] });
    render(<ParkEvents refreshTrigger={0} />);
    await screen.findByText('Fall Color Hike');
    expect(calls.some(url => url.includes('/api/events/past'))).toBe(false);

    fireEvent.click(dateButton());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Past' }));

    expect(await screen.findByText('Summer Concert')).toBeTruthy();
    expect(calls.some(url => url.includes('/api/events/past'))).toBe(true);
    expect(dateButton().getAttribute('aria-label')).toBe('Event dates: Past');
  });

  it('keeps the menu, the view picker and Filters on screen while a range loads', async () => {
    mockEvents({ today: null, weekend: null });
    render(<ParkEvents refreshTrigger={0} viewPicker={<button type="button">view picker</button>} />);

    expect(screen.getByText('Loading events...')).toBeTruthy();
    expect(dateButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'view picker' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  });
});
