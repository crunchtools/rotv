import { describe, it, expect } from 'vitest';
import { isParkPin } from './poiKind';
import { getNavigationStops } from '../components/sidebar/helpers';

describe('isParkPin', () => {
  const park = { poi_roles: ['boundary'], boundary_type: 'park', latitude: '41.26', longitude: '-81.63' };

  it('gives a pin to a park boundary that has coordinates', () => {
    expect(isParkPin(park)).toBe(true);
  });

  it('gives none to a park without coordinates, a town, a point, or nothing', () => {
    expect(isParkPin({ ...park, latitude: null })).toBe(false);
    expect(isParkPin({ ...park, boundary_type: 'municipal' })).toBe(false);
    expect(isParkPin({ poi_roles: ['point'], latitude: 41.2, longitude: -81.5 })).toBe(false);
    expect(isParkPin(null)).toBe(false);
  });
});

// A merged park is selected as a linear feature; Directions must still work.
describe('getNavigationStops for a park boundary', () => {
  it('uses the navigation coordinates the merge carried over', () => {
    const park = { poi_roles: ['boundary'], boundary_type: 'park', navigation_latitude: '41.26', navigation_longitude: '-81.63' };
    expect(getNavigationStops(park, true)).toEqual([{ lat: 41.26, lng: -81.63 }]);
  });

  it('has nowhere to send you without them', () => {
    expect(getNavigationStops({ poi_roles: ['boundary'], boundary_type: 'park' }, true)).toBeNull();
  });
});
