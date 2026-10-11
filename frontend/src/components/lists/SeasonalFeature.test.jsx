import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import SeasonalFeature from './SeasonalFeature';
import { useAuth } from '../../hooks/useAuth';
import { useActiveLists } from '../../hooks/useActiveLists';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useActiveLists', () => ({ useActiveLists: vi.fn() }));

const routes = [
  { id: 20, name: 'Cuyahoga River', poi_roles: ['river'] },
  { id: 21, name: 'Cuyahoga Valley Scenic Railroad', poi_roles: ['railroad'] }
];
const show = async () => {
  const view = render(<SeasonalFeature destinations={[]} routes={routes} />);
  await act(async () => { await Promise.resolve(); });
  return view;
};

beforeEach(() => {
  navigate.mockClear();
  localStorage.clear();
  useAuth.mockReturnValue({ listCheckins: [] });
  useActiveLists.mockReturnValue([]);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SeasonalFeature', () => {
  it('opens the feature it names, then names one the person has not opened', async () => {
    await show();

    fireEvent.click(screen.getByRole('button', { name: /River Levels/ }));

    expect(navigate).toHaveBeenCalledWith('/cuyahoga-river/river_levels');
    expect(screen.getByRole('button', { name: /Train Tracker/ })).toBeTruthy();
  });

  it('comes back round to the feature opened longest ago once every one has been opened', async () => {
    localStorage.setItem('rotv-features-opened', JSON.stringify(['train-tracker', 'happening', 'river-levels']));
    await show();
    expect(screen.getByRole('button', { name: /Train Tracker/ })).toBeTruthy();
  });

  it('stays hidden once closed, until a feature the person has not seen arrives', async () => {
    const first = await show();
    fireEvent.click(screen.getByRole('button', { name: 'Hide feature suggestions' }));
    expect(first.container.querySelector('.seasonal-feature-pill')).toBeNull();
    cleanup();

    useActiveLists.mockReturnValue([{
      id: 1, slug: 'fall-hiking-spree', edition: 2027, name: 'Fall Hiking Spree', featured: true, goal_count: 8,
      starts_on: '2027-09-01', ends_on: '2027-11-30', items: []
    }]);
    await show();
    expect(screen.getByRole('button', { name: /Fall Hiking Spree/ })).toBeTruthy();
  });
});
