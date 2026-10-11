import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ListCheckinControl from './ListCheckinControl';
import { useAuth } from '../../hooks/useAuth';

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }));

const list = {
  id: 1, slug: 'fall-hiking-spree', edition: 2026, name: 'Fall Hiking Spree', choice_label: "Hiker's Choice",
  starts_on: '2026-09-01', ends_on: '2026-11-30', items: [{ id: 11, poi_id: 1081, label: 'Quarry Trail' }]
};
const quarry = list.items[0];

const auth = (listCheckins = []) => {
  const value = {
    listCheckins,
    saveListCheckin: vi.fn().mockResolvedValue(null),
    removeListCheckin: vi.fn().mockResolvedValue(undefined)
  };
  useAuth.mockReturnValue(value);
  return value;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T16:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ListCheckinControl', () => {
  it('logs a hike for today in one tap', () => {
    const { saveListCheckin } = auth();
    render(<ListCheckinControl list={list} item={quarry} />);

    fireEvent.click(screen.getByRole('button', { name: /mark hiked/i }));

    expect(saveListCheckin).toHaveBeenCalledWith(1, 11, 1081, '2026-10-11');
  });

  it('shows the date of a logged hike right away and lets it be set inside the season', () => {
    const { saveListCheckin } = auth([{ list_id: 1, item_id: 11, poi_id: 1081, done_on: '2026-10-11' }]);
    render(<ListCheckinControl list={list} item={quarry} />);

    const date = screen.getByLabelText('Date you hiked Quarry Trail');
    expect(date.value).toBe('2026-10-11');
    expect(date.getAttribute('min')).toBe('2026-09-01');
    expect(date.getAttribute('max')).toBe('2026-10-11');

    fireEvent.change(date, { target: { value: '2026-12-25' } });
    expect(saveListCheckin).not.toHaveBeenCalled();
    fireEvent.change(date, { target: { value: '2026-10-04' } });
    expect(saveListCheckin).toHaveBeenCalledWith(1, 11, 1081, '2026-10-04');
  });

  it('offers no date until the hike is marked', () => {
    auth();
    render(<ListCheckinControl list={list} item={quarry} />);

    expect(screen.queryByLabelText(/date you hiked/i)).toBeNull();
  });

  it('takes a hike back when the checked button is tapped', () => {
    const { removeListCheckin } = auth([{ list_id: 1, item_id: 11, poi_id: 1081, done_on: '2026-10-04' }]);
    render(<ListCheckinControl list={list} item={quarry} />);

    fireEvent.click(screen.getByRole('button', { name: /hiked/i, pressed: true }));

    expect(removeListCheckin).toHaveBeenCalledWith(1, 11);
  });

  it('waits for a trail before logging the free choice', () => {
    const { saveListCheckin } = auth();
    const { rerender } = render(<ListCheckinControl list={list} />);
    expect(screen.getByRole('button', { name: /mark hiked/i }).disabled).toBe(true);

    rerender(<ListCheckinControl list={list} choicePoiId={1044} />);
    fireEvent.click(screen.getByRole('button', { name: /mark hiked/i }));

    expect(saveListCheckin).toHaveBeenCalledWith(1, null, 1044, '2026-10-11');
  });

  it('cannot log a hike before the season opens', () => {
    auth();
    vi.setSystemTime(new Date('2026-08-20T16:00:00Z'));
    render(<ListCheckinControl list={list} item={quarry} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Opens September 1')).toBeTruthy();
  });

  it('shows why the server refused a hike', async () => {
    const value = auth();
    value.saveListCheckin.mockResolvedValue('Only 2026-09-01 through 2026-11-30 counts for this list.');
    render(<ListCheckinControl list={list} item={quarry} />);

    fireEvent.click(screen.getByRole('button', { name: /mark hiked/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('2026-09-01 through 2026-11-30');
  });
});
