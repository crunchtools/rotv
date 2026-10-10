import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TripBuilder from './TripBuilder';

let tripState;

vi.mock('../hooks/useTrip', () => ({
  useTrip: () => tripState
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false, isAdmin: false })
}));

const stops = [
  { poi_id: 1, label: 'Boston Mill Visitor Center', latitude: 41.26, longitude: -81.56 },
  { poi_id: 2, label: 'East Rim Trailhead', latitude: 41.27, longitude: -81.54 }
];

beforeEach(() => {
  tripState = {
    trip: { id: null, name: '', stops, is_public: false, is_featured: false },
    showBuilder: false,
    setShowBuilder: vi.fn(),
    removeStop: vi.fn(),
    moveStop: vi.fn(),
    clear: vi.fn(),
    setName: vi.fn(),
    setIsPublic: vi.fn(),
    setIsFeatured: vi.fn(),
    saveTrip: vi.fn(),
    MAX_STOPS: 9
  };
});

afterEach(cleanup);

describe('TripBuilder', () => {
  it('renders nothing without a stop', () => {
    tripState.trip.stops = [];
    const { container } = render(<TripBuilder />);

    expect(container.firstChild).toBeNull();
  });

  it('is a bar with the trip, its stop count and Navigate while closed', () => {
    const { container } = render(<TripBuilder />);

    const toggle = screen.getByRole('button', { name: 'Untitled Trip · 2 stops' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.trip-builder-body')).toBeNull();

    const navigate = container.querySelector('.trip-builder-handle a.poi-action--primary');
    expect(navigate.textContent).toBe('Navigate');
    expect(navigate.getAttribute('href')).toContain('destination=41.27%2C-81.54');

    fireEvent.click(toggle);
    expect(tripState.setShowBuilder).toHaveBeenCalledWith(true);
  });

  it('says "1 stop" for a single stop', () => {
    tripState.trip.stops = stops.slice(0, 1);
    render(<TripBuilder />);

    expect(screen.getByRole('button', { name: 'Untitled Trip · 1 stop' })).toBeTruthy();
  });

  it('opens to the stops with one primary action', () => {
    tripState.showBuilder = true;
    const { container } = render(<TripBuilder />);

    expect(container.querySelector('.trip-builder.open')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('.trip-stop-label')).map(el => el.textContent))
      .toEqual(['Boston Mill Visitor Center', 'East Rim Trailhead']);

    const actions = Array.from(container.querySelectorAll('.trip-builder-actions-primary > *'));
    expect(actions.map(el => el.textContent)).toEqual(['Navigate', 'Save', 'My trips']);
    expect(actions.every(el => el.classList.contains('poi-action'))).toBe(true);
    expect(container.querySelectorAll('.poi-action--primary').length).toBe(1);
  });

  it('reorders and removes stops', () => {
    tripState.showBuilder = true;
    render(<TripBuilder />);

    const up = screen.getAllByRole('button', { name: 'Move up' });
    const down = screen.getAllByRole('button', { name: 'Move down' });
    expect(up[0].disabled).toBe(true);
    expect(down[1].disabled).toBe(true);

    fireEvent.click(down[0]);
    expect(tripState.moveStop).toHaveBeenCalledWith(0, 1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove stop' })[1]);
    expect(tripState.removeStop).toHaveBeenCalledWith(1);
  });

  it('takes two taps to discard an unsaved trip', () => {
    tripState.showBuilder = true;
    render(<TripBuilder />);

    fireEvent.click(screen.getByRole('button', { name: 'Discard trip' }));
    expect(tripState.clear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tap again to discard' }));
    expect(tripState.clear).toHaveBeenCalledTimes(1);
  });

  it('closes a saved trip in one tap', () => {
    tripState.showBuilder = true;
    tripState.trip.id = 12;
    render(<TripBuilder />);

    fireEvent.click(screen.getByRole('button', { name: 'Close trip' }));
    expect(tripState.clear).toHaveBeenCalledTimes(1);
  });

  it('opens My trips', () => {
    tripState.showBuilder = true;
    const onOpenMyTrips = vi.fn();
    render(<TripBuilder onOpenMyTrips={onOpenMyTrips} />);

    fireEvent.click(screen.getByRole('button', { name: 'My trips' }));
    expect(onOpenMyTrips).toHaveBeenCalledTimes(1);
  });
});
