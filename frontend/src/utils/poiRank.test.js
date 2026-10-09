import { describe, it, expect } from 'vitest';
import { rankPois } from './poiRank';

const park = { name: 'Furnace Run Metro Park', poi_roles: ['boundary'], boundary_type: 'park', geometry: { type: 'Polygon' } };
const trail = { name: 'Furnace Run Trail', poi_roles: ['trail'], geometry: { type: 'LineString' } };
const connector = { name: 'Furnace Run Connector', poi_roles: ['trail'], geometry: { type: 'LineString' } };
const restroom = { name: 'Furnace Run Metro Park Restroom', poi_roles: ['point'] };
const lodge = { name: 'Brushwood Lodge', poi_roles: ['point'], brief_description: 'A shelter at Furnace Run' };
const town = { name: 'Richfield', poi_roles: ['boundary'], boundary_type: 'municipal', geometry: { type: 'Polygon' } };

describe('rankPois', () => {
  it('lists the park before the trails and restroom that share its name (#712)', () => {
    const ranked = rankPois([connector, restroom, trail, lodge, park], 'furnace run');
    expect(ranked.map(p => p.name)).toEqual([
      'Furnace Run Metro Park',
      'Brushwood Lodge',
      'Furnace Run Connector',
      'Furnace Run Trail',
      'Furnace Run Metro Park Restroom'
    ]);
  });

  it('puts parks first, then destinations, then lines, then amenities', () => {
    const all = [restroom, town, trail, lodge, park].map(p => ({ ...p, brief_description: 'run' }));
    expect(rankPois(all, 'run').map(p => p.name)).toEqual([
      'Furnace Run Metro Park', 'Brushwood Lodge', 'Furnace Run Trail', 'Richfield', 'Furnace Run Metro Park Restroom'
    ]);
  });

  it('puts an exact name match above everything', () => {
    expect(rankPois([park, trail], 'Furnace Run Trail')[0]).toBe(trail);
  });

  it('prefers a name that starts with the query within a tier', () => {
    const a = { name: 'Old Mill Run', poi_roles: ['point'] };
    const b = { name: 'Mill Creek Falls', poi_roles: ['point'] };
    expect(rankPois([a, b], 'mill').map(p => p.name)).toEqual(['Mill Creek Falls', 'Old Mill Run']);
  });

  it('is alphabetical without a query, and leaves its input alone', () => {
    const input = [trail, park, lodge];
    expect(rankPois(input, '  ').map(p => p.name)).toEqual(['Brushwood Lodge', 'Furnace Run Metro Park', 'Furnace Run Trail']);
    expect(input[0]).toBe(trail);
  });
});
