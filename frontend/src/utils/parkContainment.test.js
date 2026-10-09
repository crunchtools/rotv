import { describe, it, expect } from 'vitest';
import { buildParkIndex, findContainingPark } from './parkContainment';

const square = (west, south, east, north) => [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
const park = (id, name, geometry) => ({ id, name, poi_roles: ['boundary'], boundary_type: 'park', geometry });

const national = park(1, 'Cuyahoga Valley National Park', { type: 'Polygon', coordinates: square(-81.7, 41.1, -81.5, 41.4) });
const furnaceRun = park(2, 'Furnace Run Metro Park', { type: 'Polygon', coordinates: square(-81.65, 41.25, -81.62, 41.28) });
const twoPart = park(3, 'Split Park', { type: 'MultiPolygon', coordinates: [square(-82.0, 41.0, -81.9, 41.1), square(-81.8, 41.0, -81.75, 41.05)] });
const ringed = park(4, 'Ring Park', {
  type: 'Polygon',
  coordinates: [...square(-80.2, 40.0, -80.0, 40.2), ...square(-80.15, 40.05, -80.05, 40.15)]
});
const town = { id: 5, name: 'Richfield', poi_roles: ['boundary'], boundary_type: 'municipal', geometry: { type: 'Polygon', coordinates: square(-81.7, 41.2, -81.6, 41.3) } };

const index = buildParkIndex([national, furnaceRun, twoPart, ringed, town, { id: 9, name: 'A point', poi_roles: ['point'] }]);

describe('buildParkIndex', () => {
  it('keeps park outlines only, smallest first', () => {
    expect(index.map(p => p.name)).toEqual(['Furnace Run Metro Park', 'Split Park', 'Ring Park', 'Cuyahoga Valley National Park']);
  });
});

describe('findContainingPark', () => {
  it('names the smallest park around a point', () => {
    const restroom = { id: 10, poi_roles: ['point'], latitude: '41.26', longitude: '-81.63' };
    expect(findContainingPark(restroom, index)).toEqual({ id: 2, name: 'Furnace Run Metro Park' });
  });

  it('falls back to the larger park outside the small one', () => {
    expect(findContainingPark({ id: 11, latitude: 41.15, longitude: -81.55 }, index)?.name).toBe('Cuyahoga Valley National Park');
  });

  it('places a trail by its first point', () => {
    const trail = { id: 12, poi_roles: ['trail'], geometry: { type: 'LineString', coordinates: [[-81.63, 41.26], [-81.0, 41.0]] } };
    expect(findContainingPark(trail, index)?.name).toBe('Furnace Run Metro Park');
  });

  it('checks every part of a multi-part park and respects holes', () => {
    expect(findContainingPark({ id: 13, latitude: 41.02, longitude: -81.78 }, index)?.name).toBe('Split Park');
    expect(findContainingPark({ id: 14, latitude: 40.1, longitude: -80.1 }, index)).toBeNull();
    expect(findContainingPark({ id: 15, latitude: 40.02, longitude: -80.02 }, index)?.name).toBe('Ring Park');
  });

  it('never reports a park as inside itself, and returns null with no location', () => {
    expect(findContainingPark(furnaceRun, index)?.name).not.toBe('Furnace Run Metro Park');
    expect(findContainingPark({ id: 16 }, index)).toBeNull();
    expect(findContainingPark({ id: 17, latitude: 10, longitude: 10 }, index)).toBeNull();
  });
});
