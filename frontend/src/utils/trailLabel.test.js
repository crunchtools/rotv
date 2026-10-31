import { describe, it, expect } from 'vitest';
import { trailLabelPosition } from './trailLabel';

describe('trailLabelPosition', () => {
  it('returns the midpoint of a LineString as [lat, lng]', () => {
    const geometry = { type: 'LineString', coordinates: [[-81, 41], [-81, 42], [-81, 45]] };
    expect(trailLabelPosition(geometry)).toEqual([43, -81]);
  });

  it('uses the longest line of a MultiLineString', () => {
    const geometry = {
      type: 'MultiLineString',
      coordinates: [[[-80, 41], [-80, 41.1]], [[-81, 41], [-81, 43]]],
    };
    expect(trailLabelPosition(geometry)).toEqual([42, -81]);
  });

  it('returns null without a usable line', () => {
    expect(trailLabelPosition(null)).toBeNull();
    expect(trailLabelPosition({ type: 'Point', coordinates: [-81, 41] })).toBeNull();
    expect(trailLabelPosition({ type: 'LineString', coordinates: [[-81, 41], [-81, 41]] })).toBeNull();
  });
});
