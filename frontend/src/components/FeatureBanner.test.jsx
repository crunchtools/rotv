import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import FeatureBanner from './FeatureBanner';
import { featureSlides } from '../hooks/useFeatureSlides';
import { useAuth } from '../hooks/useAuth';
import { useActiveLists } from '../hooks/useActiveLists';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../hooks/useActiveLists', () => ({ useActiveLists: vi.fn() }));

const spree = {
  id: 1, slug: 'fall-hiking-spree', edition: 2026, name: 'Fall Hiking Spree', featured: true, goal_count: 8,
  starts_on: '2026-09-01', ends_on: '2026-11-30', hero_image: '/lists/spree.webp', choice_label: null,
  items: Array.from({ length: 13 }, (_, i) => ({ id: 100 + i, poi_id: 1000 + i }))
};
const routes = [
  { id: 20, name: 'Cuyahoga River', poi_roles: ['river'], has_primary_image: true, updated_at: 'r' },
  { id: 21, name: 'Cuyahoga Valley Scenic Railroad', poi_roles: ['organization', 'railroad'], has_primary_image: true, updated_at: 't' },
  { id: 22, name: 'Harbor Hopper', poi_roles: ['water_taxi'], has_primary_image: false }
];
const gauges = [
  { id: 1, name: 'Hiram Rapids', river_poi_id: 20, latest: null },
  { id: 2, name: 'Old Portage', river_poi_id: 20, latest: { discharge_cfs: 80 } },
  { id: 3, name: 'Jaite', river_poi_id: 20, latest: { discharge_cfs: 1234.4 } }
];
const destinations = [
  { id: 1, name: 'East Rim Trailhead', status_url: 'https://example.org/east-rim', has_primary_image: true, updated_at: 'a' },
  { id: 2, name: 'Hampton Hills Mountain Bike Trailhead', status_url: 'https://example.org/hh', has_primary_image: true, updated_at: 'b' },
  { id: 3, name: 'Ledges Overlook', has_primary_image: true, updated_at: 'c' },
  { id: 4, name: 'A Place With No Photo', has_primary_image: false }
];

beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockClear();
  localStorage.clear();
  useAuth.mockReturnValue({ listCheckins: [] });
  useActiveLists.mockReturnValue([spree]);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ status: 'open' }, { status: 'closed' }, { status: 'open' }] })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('featureSlides', () => {
  it('advertises the spree in season, MTB trail status, and Happening', () => {
    const slides = featureSlides({ list: spree, listCheckins: [], destinations, mtb: { open: 2, total: 3 } });

    expect(slides.map(s => [s.id, s.to])).toEqual([
      ['list-fall-hiking-spree-2026', '/fall-hiking-spree'], ['mtb', '/mtb-trail-status'], ['happening', '/happening']
    ]);
    expect(slides[0]).toMatchObject({ images: ['/lists/spree.webp'], imageHasTitle: true, text: 'Through November 30 · 13 trails' });
    expect(slides[1].text).toBe('2 of 3 trails open right now');
    expect(slides.map(s => s.cta)).toEqual(['Open Fall Hiking Spree', 'Check trail status', "See what's on"]);
    // The preferred place's photo first, then the others to fall back on
    expect(slides[1].images).toEqual(['/api/pois/2/thumbnail?size=medium&v=b', '/api/pois/1/thumbnail?size=medium&v=a']);
    expect(slides[2].images[0]).toBe('/api/pois/3/thumbnail?size=medium&v=c');
  });

  it('shows the person\'s tally on the spree', () => {
    const hikes = [100, 101].map(id => ({ list_id: 1, item_id: id, poi_id: 1, done_on: '2026-10-01' }));
    expect(featureSlides({ list: spree, listCheckins: hikes, destinations, mtb: null })[0].text).toBe('2 of 8 hiked · 13 trails');
  });

  it('leaves out the spree out of season and MTB where no trail reports status', () => {
    const slides = featureSlides({ list: null, listCheckins: [], destinations: [destinations[3]], mtb: null });
    expect(slides.map(s => s.id)).toEqual(['happening']);
    expect(slides[0].images).toEqual([]);
  });
});

describe('the live features', () => {
  it('advertises river levels, the train and the water taxi, each with its own photo and a link to its place', () => {
    const slides = featureSlides({ list: null, listCheckins: [], destinations: [], routes, mtb: null, gauges });

    expect(slides.map(s => [s.id, s.to])).toEqual([
      ['river-levels', '/cuyahoga-river/river_levels'],
      ['train-tracker', '/cuyahoga-valley-scenic-railroad'],
      ['water-taxi', '/harbor-hopper'],
      ['happening', '/happening']
    ]);
    // The gauge inside the park, not the first one upstream
    expect(slides[0].text).toBe('1,234 cfs at Jaite right now, with a 7-day chart');
    expect(slides[0].short).toBe('1,234 cfs at Jaite');
    expect(slides[0].images).toEqual(['/api/pois/20/thumbnail?size=medium&v=r']);
    expect(slides[2].images).toEqual([]);
    expect(slides.every(s => s.icon && s.short && s.cta)).toBe(true);
  });

  it('still advertises river levels before a reading has loaded', () => {
    const [river] = featureSlides({ list: null, listCheckins: [], destinations: [], routes, mtb: null });
    expect(river.text).toBe('Is the river runnable? Live flow and a 7-day chart.');
  });
});

describe('FeatureBanner', () => {
  it('leads with a feature the person has not opened, and remembers the one they open', async () => {
    localStorage.setItem('rotv-features-opened', JSON.stringify(['list-fall-hiking-spree-2026']));
    render(<FeatureBanner destinations={destinations} />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByText('2 of 3 trails open right now'));

    expect(navigate).toHaveBeenCalledWith('/mtb-trail-status');
    expect(JSON.parse(localStorage.getItem('rotv-features-opened'))).toEqual(['list-fall-hiking-spree-2026', 'mtb']);
  });

  it('leaves out the page it is on, and shows nothing when that was the only feature', async () => {
    const { container, rerender } = render(<FeatureBanner destinations={destinations} exclude="happening" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: 'Show Happening in the valley' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show MTB Trail Status' })).toBeTruthy();

    useActiveLists.mockReturnValue([]);
    rerender(<FeatureBanner destinations={[]} exclude="happening" />);
    expect(container.querySelector('.feature-banner')).toBeNull();
  });

  it('rotates on its own and opens the feature shown', async () => {
    render(<FeatureBanner destinations={destinations} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Through November 30 · 13 trails')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.getByText('2 of 3 trails open right now')).toBeTruthy();

    fireEvent.click(screen.getByText('2 of 3 trails open right now'));
    expect(navigate).toHaveBeenCalledWith('/mtb-trail-status');
  });

  it('says where a tap goes, and does not print a name the photo already carries', async () => {
    const { container } = render(<FeatureBanner destinations={destinations} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('Open Fall Hiking Spree')).toBeTruthy();
    expect(container.querySelector('.feature-banner-title').className).toContain('visually-hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Show MTB Trail Status' }));
    expect(screen.getByText('Check trail status')).toBeTruthy();
    expect(container.querySelector('.feature-banner-title').className).not.toContain('visually-hidden');
  });

  it('stops rotating once the person picks a slide', async () => {
    render(<FeatureBanner destinations={destinations} />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole('button', { name: 'Show Happening in the valley' }));
    act(() => { vi.advanceTimersByTime(30000); });

    expect(screen.getByText('News and events from every park, in one place.')).toBeTruthy();
  });

  it('holds still for someone who asked for less motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<FeatureBanner destinations={destinations} />);
    await act(async () => { await Promise.resolve(); });

    act(() => { vi.advanceTimersByTime(30000); });

    expect(screen.getByText('Through November 30 · 13 trails')).toBeTruthy();
  });

  it('tries the next photo when one will not load, then shows the feature\'s name alone', async () => {
    useActiveLists.mockReturnValue([]);
    const { container } = render(<FeatureBanner destinations={destinations} />);
    await act(async () => { await Promise.resolve(); });

    const photo = () => container.querySelector('.feature-banner-photo');
    const firstPhoto = photo().getAttribute('src');
    fireEvent.error(photo());
    expect(photo().getAttribute('src')).not.toBe(firstPhoto);
    fireEvent.error(photo());

    expect(photo()).toBeNull();
    expect(container.querySelector('.feature-banner-slide.plain .feature-banner-title').textContent).toBe('MTB Trail Status');
  });
});
