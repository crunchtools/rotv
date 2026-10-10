import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useContext, useEffect } from 'react';
import { TripContext, TripProvider } from './TripContext';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false })
}));

vi.mock('../utils/analytics', () => ({ track: vi.fn() }));

const captured = { current: null };
function Probe() {
  const ctx = useContext(TripContext);
  useEffect(() => { captured.current = ctx; });
  return null;
}

const visitorCenter = { poi_id: 1, label: 'Boston Mill Visitor Center', latitude: 41.26, longitude: -81.56 };

beforeEach(() => {
  localStorage.clear();
  render(<TripProvider><Probe /></TripProvider>);
});

afterEach(cleanup);

describe('TripProvider', () => {
  it('adds a stop without opening the stops', () => {
    act(() => captured.current.addStop(visitorCenter));

    expect(captured.current.trip.stops.map(stop => stop.label)).toEqual(['Boston Mill Visitor Center']);
    expect(captured.current.showBuilder).toBe(false);
  });

  it('adds the same place only once', () => {
    act(() => captured.current.addStop(visitorCenter));
    act(() => captured.current.addStop(visitorCenter));

    expect(captured.current.trip.stops.length).toBe(1);
  });

  it('opens the stops for a loaded trip', () => {
    act(() => captured.current.loadTrip({ id: 4, name: 'Valley loop', stops: [visitorCenter] }));

    expect(captured.current.trip.name).toBe('Valley loop');
    expect(captured.current.showBuilder).toBe(true);
  });
});
