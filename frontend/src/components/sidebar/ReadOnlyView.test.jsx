import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ReadOnlyView from './ReadOnlyView';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    isFavorited: () => true,
    toggleFavorite: vi.fn(),
    isVisited: () => false,
    toggleVisited: vi.fn()
  })
}));

vi.mock('../../hooks/useTrip', () => ({
  useTrip: () => ({
    trip: { stops: [] },
    addStop: vi.fn(),
    removeStopByPoi: vi.fn(),
    hasStop: () => false,
    MAX_STOPS: 10
  })
}));

const trailhead = {
  id: 7,
  name: 'East Rim Trailhead',
  poi_roles: ['point'],
  latitude: 41.26,
  longitude: -81.55,
  status_url: 'https://example.org/status',
  era_name: 'Modern Era',
  owner_name: 'Private',
  is_seasonal: true,
  is_ada_accessible: true
};

const trailStatus = {
  status: 'open',
  conditions: 'Dry and fast.',
  last_updated: '2026-10-08T12:00:00Z',
  source_url: 'https://example.org/source'
};

const renderView = (props = {}) => render(
  <ReadOnlyView
    destination={trailhead}
    trailStatus={trailStatus}
    onShare={() => {}}
    moreInfoLink="https://example.org/more"
    {...props}
  />
);

afterEach(cleanup);

describe('ReadOnlyView labels and actions', () => {
  it('keeps everything tappable out of the tags', () => {
    const { container } = renderView();

    const tags = Array.from(container.querySelectorAll('.poi-tags > *'));
    expect(tags.map(tag => tag.textContent)).toEqual(['MTB Trailhead', 'Seasonal', 'ADA', 'Modern Era', 'Private', 'Open']);
    expect(container.querySelectorAll('.poi-tags button, .poi-tags a').length).toBe(0);
  });

  it('leads the actions with Navigate as the one primary button', () => {
    const { container } = renderView();

    const actions = Array.from(container.querySelectorAll('.poi-actions > *'));
    expect(actions.map(action => action.textContent)).toEqual(['Navigate', 'Share', 'Favorited', 'More info', 'Add to Trip', 'Mark visited']);
    expect(actions.every(action => action.classList.contains('poi-action'))).toBe(true);
    expect(actions[0].getAttribute('title')).toBe('Open in Google Maps');
    expect(container.querySelectorAll('.poi-action--primary').length).toBe(1);
    expect(actions[0].classList.contains('poi-action--primary')).toBe(true);
  });

  it('marks the toggles as pressed or not', () => {
    const { container } = renderView();

    expect(container.querySelector('.favorite-toggle-btn').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.visited-toggle-btn').getAttribute('aria-pressed')).toBe('false');
  });

  it('puts More info in the actions as an external link', () => {
    const { container } = renderView();

    const link = container.querySelector('.poi-actions a.more-info-link');
    expect(link.getAttribute('href')).toBe('https://example.org/more');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(container.querySelectorAll('.more-info-link').length).toBe(1);
  });

  it('shows the trail status source as a text link beside the updated time', () => {
    const { container } = renderView();

    const source = container.querySelector('.section .trail-status-updated a.link-button');
    expect(source.textContent).toBe('Source');
    expect(source.getAttribute('href')).toBe('https://example.org/source');
  });

  it('still shows the source when it is all the status has', () => {
    const { container } = renderView({ trailStatus: { status: 'open', source_url: 'https://example.org/source' } });

    expect(container.querySelector('.trail-status-updated').textContent).toBe('Source');
  });

  it('drops Navigate and Add to trip for a place with no location', () => {
    const { container } = renderView({
      destination: { id: 9, name: 'Friends of the Valley', poi_roles: ['organization'] },
      trailStatus: null,
      moreInfoLink: null
    });

    const actions = Array.from(container.querySelectorAll('.poi-actions > *'));
    expect(actions.map(action => action.textContent)).toEqual(['Share', 'Favorited', 'Mark visited']);
    expect(container.querySelectorAll('.poi-action--primary').length).toBe(0);
  });
});
