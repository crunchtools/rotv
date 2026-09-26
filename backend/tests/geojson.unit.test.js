import { describe, it, expect } from 'vitest';
import { consolidateFeatures } from '../utils/geojson.js';

const line = (name, coords) => ({ properties: { name }, geometry: { type: 'LineString', coordinates: coords } });
const poly = (name, ring) => ({ properties: { name }, geometry: { type: 'Polygon', coordinates: [ring] } });

describe('consolidateFeatures', () => {
  it('passes a single-geometry group through unchanged', () => {
    const feature = line('Towpath', [[0, 0], [1, 1]]);
    expect(consolidateFeatures([feature])).toEqual([{ name: 'Towpath', geometry: feature.geometry }]);
  });

  it('merges same-named lines into a MultiLineString', () => {
    const merged = consolidateFeatures([
      line('Towpath', [[0, 0], [1, 1]]),
      { properties: { name: 'Towpath' }, geometry: { type: 'MultiLineString', coordinates: [[[2, 2], [3, 3]]] } }
    ]);
    expect(merged).toEqual([{
      name: 'Towpath',
      geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }
    }]);
  });

  it('merges same-named polygons into a MultiPolygon', () => {
    const ringA = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const ringB = [[5, 5], [6, 5], [6, 6], [5, 5]];
    const merged = consolidateFeatures([poly('Park', ringA), poly('Park', ringB)]);
    expect(merged).toEqual([{
      name: 'Park',
      geometry: { type: 'MultiPolygon', coordinates: [[ringA], [ringB]] }
    }]);
  });

  it('groups unnamed features under Unnamed and keeps first-seen order', () => {
    const merged = consolidateFeatures([
      line('B', [[0, 0], [1, 1]]),
      { geometry: { type: 'LineString', coordinates: [[2, 2], [3, 3]] } },
      line('A', [[4, 4], [5, 5]])
    ]);
    expect(merged.map(f => f.name)).toEqual(['B', 'Unnamed', 'A']);
  });
});
