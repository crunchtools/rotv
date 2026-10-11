import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ListChallenge from './ListChallenge';
import { useAuth } from '../../hooks/useAuth';

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }));

const list = {
  id: 1, slug: 'fall-hiking-spree', edition: 2026, name: 'Fall Hiking Spree',
  description: 'Hike at least eight of these trails.', goal_count: 2, choice_label: null,
  starts_on: '2026-09-01', ends_on: '2026-11-30', source_url: 'https://example.org/spree',
  hero_image: '/lists/fall-hiking-spree-2026.webp', hero_credit: 'Summit Metro Parks',
  items: [{ id: 11, poi_id: 1081, label: 'Quarry Trail' }, { id: 12, poi_id: 1054, label: 'Missing Link Trail' }]
};

const renderWith = (overrides = {}, listCheckins = []) => {
  useAuth.mockReturnValue({ isAuthenticated: true, listCheckins, saveListCheckin: vi.fn(), removeListCheckin: vi.fn() });
  return render(<ListChallenge list={{ ...list, ...overrides }} />);
};

afterEach(cleanup);

describe('ListChallenge', () => {
  it('shows the banner, credited with a link to the organizer', () => {
    renderWith();

    const banner = screen.getByRole('img', { name: 'Fall Hiking Spree, September 1 to November 30' });
    expect(banner.getAttribute('src')).toBe('/lists/fall-hiking-spree-2026.webp');
    const credit = screen.getByRole('link', { name: 'Summit Metro Parks' });
    expect(credit.getAttribute('href')).toBe('https://example.org/spree');
    expect(credit.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('credits the banner in plain text when the list has no page to link', () => {
    renderWith({ source_url: null });

    expect(screen.queryByRole('link', { name: 'Summit Metro Parks' })).toBeNull();
    expect(screen.getByText(/Summit Metro Parks/)).toBeTruthy();
  });

  it('shows the description and tally without a banner', () => {
    const { container } = renderWith({ hero_image: null });

    expect(container.querySelector('.list-hero')).toBeNull();
    expect(screen.getByText('Hike at least eight of these trails.')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('counts the hikes logged and says when the badge is earned', () => {
    renderWith({}, [
      { list_id: 1, item_id: 11, poi_id: 1081, done_on: '2026-09-05' },
      { list_id: 1, item_id: 12, poi_id: 1054, done_on: '2026-09-12' }
    ]);

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
    expect(screen.getByText('Badge earned September 12.')).toBeTruthy();
  });
});
