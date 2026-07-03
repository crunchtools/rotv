/**
 * Track Interpolation Unit Tests
 * Covers the arc-distance direction logic that replaced GPS-heading-vs-track-
 * bearing comparison (train icon flipping backwards) and the arc-based frame
 * positioning used by the marker tween.
 */
import { describe, it, expect } from 'vitest';
import {
  lineCumulativeDistances, arcDistanceAt, snapAtArc,
} from '../../frontend/src/utils/trackInterpolation.js';
import { snapToLine } from '../../frontend/src/utils/snapToLine.js';

// North-south track at CVSR longitude: GeoJSON [lng, lat], ~111m per vertex
const TRACK = [
  [-81.625, 41.380],
  [-81.625, 41.381],
  [-81.625, 41.382],
  [-81.625, 41.383],
  [-81.625, 41.384],
];

describe('lineCumulativeDistances', () => {
  it('is zero at the start and strictly increasing', () => {
    const dists = lineCumulativeDistances(TRACK);
    expect(dists[0]).toBe(0);
    for (let i = 1; i < dists.length; i++) {
      expect(dists[i]).toBeGreaterThan(dists[i - 1]);
    }
  });

  it('matches haversine scale (~111m per 0.001° latitude)', () => {
    const dists = lineCumulativeDistances(TRACK);
    expect(dists[1]).toBeGreaterThan(105);
    expect(dists[1]).toBeLessThan(117);
    expect(dists[4]).toBeCloseTo(dists[1] * 4, 0);
  });
});

describe('arcDistanceAt — travel direction from arc delta', () => {
  // ~9m east of the track: the raw GPS never sits ON the line geometry
  const OFF_TRACK_LNG = -81.62489;

  it('northbound travel gives a positive arc delta despite the offset', () => {
    const a = snapToLine([41.3805, OFF_TRACK_LNG], TRACK);
    const b = snapToLine([41.3825, OFF_TRACK_LNG], TRACK);
    const dists = lineCumulativeDistances(TRACK);
    expect(arcDistanceAt(dists, b) - arcDistanceAt(dists, a)).toBeGreaterThan(100);
  });

  it('southbound travel gives a negative arc delta despite the offset', () => {
    const a = snapToLine([41.3825, OFF_TRACK_LNG], TRACK);
    const b = snapToLine([41.3805, OFF_TRACK_LNG], TRACK);
    const dists = lineCumulativeDistances(TRACK);
    expect(arcDistanceAt(dists, b) - arcDistanceAt(dists, a)).toBeLessThan(-100);
  });

  it('an identical off-track fix re-delivered yields zero arc delta', () => {
    // Regression: the old raw-vs-snapped comparison saw the 9m perpendicular
    // offset as movement on every poll and re-tossed direction from it.
    const a = snapToLine([41.3815, OFF_TRACK_LNG], TRACK);
    const b = snapToLine([41.3815, OFF_TRACK_LNG], TRACK);
    const dists = lineCumulativeDistances(TRACK);
    expect(arcDistanceAt(dists, b) - arcDistanceAt(dists, a)).toBe(0);
  });

  it('flipping the offset side of the track does not flip the arc delta sign', () => {
    const eastA = snapToLine([41.3805, -81.62489], TRACK);
    const westB = snapToLine([41.3825, -81.62511], TRACK);
    const dists = lineCumulativeDistances(TRACK);
    expect(arcDistanceAt(dists, westB) - arcDistanceAt(dists, eastA)).toBeGreaterThan(100);
  });
});

describe('snapAtArc', () => {
  it('round-trips with arcDistanceAt', () => {
    const dists = lineCumulativeDistances(TRACK);
    const snap = snapToLine([41.3815, -81.62489], TRACK);
    const arc = arcDistanceAt(dists, snap);
    const located = snapAtArc(TRACK, dists, arc);
    expect(located.position[0]).toBeCloseTo(snap.position[0], 8);
    expect(located.position[1]).toBeCloseTo(snap.position[1], 8);
    expect(arcDistanceAt(dists, located)).toBeCloseTo(arc, 6);
  });

  it('clamps below zero and beyond the line end', () => {
    const dists = lineCumulativeDistances(TRACK);
    expect(snapAtArc(TRACK, dists, -50).position).toEqual([41.380, -81.625]);
    const end = snapAtArc(TRACK, dists, dists[dists.length - 1] + 500);
    expect(end.position[0]).toBeCloseTo(41.384, 8);
    expect(end.position[1]).toBeCloseTo(-81.625, 8);
  });

  it('places the halfway arc at the geometric midpoint', () => {
    const dists = lineCumulativeDistances(TRACK);
    const mid = snapAtArc(TRACK, dists, dists[dists.length - 1] / 2);
    expect(mid.position[0]).toBeCloseTo(41.382, 4);
    expect(mid.bearing).toBeCloseTo(0, 0);
  });
});

