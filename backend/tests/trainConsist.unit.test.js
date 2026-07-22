/**
 * Train Consist Unit Tests
 * Covers the arc-offset placement of the CVSR consist: which unit lands on the
 * reported GPS position (#573), ordering under both travel directions, the tail
 * engine's 180° flip, zoom-dependent spacing, endpoint clamping, and curve
 * following.
 */
import { describe, it, expect } from 'vitest';
import {
  buildConsist, unitSpacingMeters, CONSIST_UNITS, MIN_CONSIST_ZOOM,
} from '../../frontend/src/utils/trainConsist.js';
import { lineCumulativeDistances, haversineDist } from '../../frontend/src/utils/trackInterpolation.js';

// Straight north-south track at CVSR longitude: GeoJSON [lng, lat]. ~111m per
// vertex step, ~4.4km end to end — long enough to hold a consist at z14
// spacing without clamping.
const STRAIGHT = Array.from({ length: 41 }, (_, i) => [-81.625, 41.380 + i * 0.001]);
const STRAIGHT_DISTS = lineCumulativeDistances(STRAIGHT);
const STRAIGHT_TOTAL = STRAIGHT_DISTS[STRAIGHT_DISTS.length - 1];

// Quarter-circle arc, ~1km radius, curving from due-north to due-east. Used to
// prove units follow the geometry rather than sitting on a rigid straight bar.
const CURVE = Array.from({ length: 60 }, (_, i) => {
  const t = (i / 59) * (Math.PI / 2);
  return [-81.625 + 0.012 * Math.sin(t), 41.380 + 0.009 * (1 - Math.cos(t))];
});
const CURVE_DISTS = lineCumulativeDistances(CURVE);

const build = (opts) => buildConsist({
  lineCoords: STRAIGHT, lineDists: STRAIGHT_DISTS, zoom: 16, ...opts,
});

// Derived here from the declarative `tracked` flag rather than imported, so a
// bug in the module's own derivation is caught instead of asserted against
// itself.
const trackedIndex = Math.max(0, CONSIST_UNITS.findIndex(u => u.tracked));

describe('CONSIST_UNITS', () => {
  it('marks exactly one unit as carrying the GPS device', () => {
    expect(CONSIST_UNITS.filter(u => u.tracked)).toHaveLength(1);
  });

  it('does not track the lead engine', () => {
    // The premise of #573. Asserted rather than assumed, because several
    // placement tests below would pass vacuously if the tracked unit were the
    // lead — the exact configuration this change exists to move away from.
    expect(trackedIndex).toBeGreaterThan(0);
  });

  it('is ordered front to back, engines at both ends', () => {
    expect(CONSIST_UNITS[0].kind).toBe('engine');
    expect(CONSIST_UNITS[CONSIST_UNITS.length - 1].kind).toBe('engine');
    expect(CONSIST_UNITS[CONSIST_UNITS.length - 1].flip).toBe(true);
  });
});

describe('unitSpacingMeters', () => {
  it('uses the pixel-derived gap at browsing zooms', () => {
    // A 25m car is ~3.5px at z14 — spacing must be far larger to stay readable.
    expect(unitSpacingMeters(14)).toBeGreaterThan(300);
  });

  it('shrinks as the user zooms in', () => {
    expect(unitSpacingMeters(16)).toBeLessThan(unitSpacingMeters(14));
    expect(unitSpacingMeters(18)).toBeLessThan(unitSpacingMeters(16));
  });

  it('floors at prototype car length once zoomed past ~z18', () => {
    expect(unitSpacingMeters(20)).toBe(25);
    expect(unitSpacingMeters(22)).toBe(25);
  });

  it('never returns less than a real car length', () => {
    for (let z = 10; z <= 22; z++) {
      expect(unitSpacingMeters(z)).toBeGreaterThanOrEqual(25);
    }
  });
});

describe('buildConsist placement', () => {
  it('returns one entry per defined unit, lead first', () => {
    const consist = build({ anchorArc: STRAIGHT_TOTAL / 2, direction: 1 });
    expect(consist).toHaveLength(CONSIST_UNITS.length);
    expect(consist[0].key).toBe('lead');
    expect(consist.map(u => u.kind)).toEqual(['engine', 'zephyr', 'zephyr', 'engine']);
  });

  it('trails units behind the lead when running forward along the line', () => {
    const anchorArc = STRAIGHT_TOTAL / 2;
    const consist = build({ anchorArc, direction: 1 });
    // Track runs south-to-north, so trailing units are progressively further south.
    const lats = consist.map(u => u.position[0]);
    for (let i = 1; i < lats.length; i++) {
      expect(lats[i]).toBeLessThan(lats[i - 1]);
    }
  });

  it('trails units the other way when direction reverses', () => {
    const anchorArc = STRAIGHT_TOTAL / 2;
    const consist = build({ anchorArc, direction: -1 });
    const lats = consist.map(u => u.position[0]);
    for (let i = 1; i < lats.length; i++) {
      expect(lats[i]).toBeGreaterThan(lats[i - 1]);
    }
  });

  it('spaces adjacent units by the zoom spacing', () => {
    const zoom = 16;
    const consist = build({ anchorArc: STRAIGHT_TOTAL / 2, direction: 1, zoom });
    const expected = unitSpacingMeters(zoom);
    for (let i = 1; i < consist.length; i++) {
      const gap = haversineDist(
        consist[i - 1].position[0], consist[i - 1].position[1],
        consist[i].position[0], consist[i].position[1]
      );
      expect(gap).toBeCloseTo(expected, 0);
    }
  });

  it('puts the TRACKED unit exactly on the anchor arc, not the lead engine', () => {
    // This is the whole point of #573: the GPS device rides in a specific unit,
    // and that unit — not the head of the train — lands on the reported fix.
    for (const direction of [1, -1]) {
      const consist = build({ anchorArc: STRAIGHT_TOTAL / 2, direction });
      const tracked = consist[trackedIndex];
      const fromStart = haversineDist(
        STRAIGHT[0][1], STRAIGHT[0][0],
        tracked.position[0], tracked.position[1]
      );
      expect(fromStart).toBeCloseTo(STRAIGHT_TOTAL / 2, 0);
    }
  });

  it('does NOT put the lead engine on the anchor arc', () => {
    // Regression guard for the spec 042 behaviour this replaces.
    const consist = build({ anchorArc: STRAIGHT_TOTAL / 2, direction: 1 });
    const fromStart = haversineDist(
      STRAIGHT[0][1], STRAIGHT[0][0],
      consist[0].position[0], consist[0].position[1]
    );
    expect(Math.abs(fromStart - STRAIGHT_TOTAL / 2)).toBeGreaterThan(1);
  });

  it('draws units ahead of the tracked one forward along travel', () => {
    const anchorArc = STRAIGHT_TOTAL / 2;
    const consist = build({ anchorArc, direction: 1 });
    const trackedLat = consist[trackedIndex].position[0];
    // Heading north: anything ahead of the tracked unit is further north.
    for (let i = 0; i < trackedIndex; i++) {
      expect(consist[i].position[0]).toBeGreaterThan(trackedLat);
    }
    for (let i = trackedIndex + 1; i < consist.length; i++) {
      expect(consist[i].position[0]).toBeLessThan(trackedLat);
    }
  });

  it('offsets each unit from the anchor by its index distance', () => {
    const zoom = 17;
    const anchorArc = STRAIGHT_TOTAL / 2;
    const consist = build({ anchorArc, direction: 1, zoom });
    const spacing = unitSpacingMeters(zoom);
    const tracked = consist[trackedIndex].position;
    consist.forEach((unit, i) => {
      const gap = haversineDist(tracked[0], tracked[1], unit.position[0], unit.position[1]);
      expect(gap).toBeCloseTo(Math.abs(trackedIndex - i) * spacing, 0);
    });
  });
});

describe('buildConsist bearings', () => {
  it('faces the direction of travel and flips the tail engine', () => {
    const consist = build({ anchorArc: STRAIGHT_TOTAL / 2, direction: 1 });
    // Northbound on a due-north track.
    expect(consist[0].bearing).toBeCloseTo(0, 0);
    expect(consist[1].bearing).toBeCloseTo(0, 0);
    expect(consist[2].bearing).toBeCloseTo(0, 0);
    // Tail engine is dragged backwards.
    expect(consist[3].bearing).toBeCloseTo(180, 0);
  });

  it('flips every unit when the train reverses', () => {
    const consist = build({ anchorArc: STRAIGHT_TOTAL / 2, direction: -1 });
    expect(consist[0].bearing).toBeCloseTo(180, 0);
    expect(consist[3].bearing).toBeCloseTo(0, 0);
  });

  it('keeps the tail engine 180° from the lead in both directions', () => {
    for (const direction of [1, -1]) {
      const consist = build({ anchorArc: STRAIGHT_TOTAL / 2, direction });
      const delta = Math.abs(((consist[3].bearing - consist[0].bearing) + 360) % 360);
      expect(delta).toBeCloseTo(180, 0);
    }
  });

  it('treats a missing direction as running forward', () => {
    const forward = build({ anchorArc: STRAIGHT_TOTAL / 2, direction: 1 });
    const absent = build({ anchorArc: STRAIGHT_TOTAL / 2, direction: undefined });
    expect(absent[0].bearing).toBeCloseTo(forward[0].bearing, 6);
    expect(absent[3].position).toEqual(forward[3].position);
  });
});

describe('buildConsist on a curve', () => {
  const curved = buildConsist({
    lineCoords: CURVE,
    lineDists: CURVE_DISTS,
    anchorArc: CURVE_DISTS[CURVE_DISTS.length - 1] * 0.6,
    direction: 1,
    zoom: 17,
  });

  it('gives each unit its own bearing rather than the lead\'s', () => {
    const bearings = curved.map(u => u.bearing);
    // Tail engine carries the flip, so compare the three forward-facing units.
    expect(bearings[1]).not.toBeCloseTo(bearings[0], 1);
    expect(bearings[2]).not.toBeCloseTo(bearings[1], 1);
  });

  it('bends with the track instead of forming a straight bar', () => {
    // If the consist were rigid, the middle units would sit exactly on the
    // straight line between the head and tail. Measure that deviation.
    const [head, , , tail] = curved;
    const mid = curved[1].position;
    const cross = Math.abs(
      (tail.position[0] - head.position[0]) * (head.position[1] - mid[1]) -
      (head.position[0] - mid[0]) * (tail.position[1] - head.position[1])
    );
    expect(cross).toBeGreaterThan(0);
  });
});

describe('buildConsist edge cases', () => {
  it('clamps against the line start instead of running off the end', () => {
    const consist = build({ anchorArc: 5, direction: 1 });
    expect(consist).toHaveLength(CONSIST_UNITS.length);
    for (const unit of consist) {
      expect(Number.isFinite(unit.position[0])).toBe(true);
      expect(unit.position[0]).toBeGreaterThanOrEqual(STRAIGHT[0][1] - 1e-9);
    }
  });

  it('clamps against the line end too', () => {
    const consist = build({ anchorArc: STRAIGHT_TOTAL - 5, direction: -1 });
    const lastLat = STRAIGHT[STRAIGHT.length - 1][1];
    for (const unit of consist) {
      expect(unit.position[0]).toBeLessThanOrEqual(lastLat + 1e-9);
    }
  });

  it('returns nothing without usable geometry', () => {
    expect(buildConsist({ lineCoords: null, lineDists: null, anchorArc: 0, direction: 1, zoom: 16 })).toEqual([]);
    expect(buildConsist({ lineCoords: [[-81.6, 41.3]], lineDists: [0], anchorArc: 0, direction: 1, zoom: 16 })).toEqual([]);
  });

  it('returns nothing when the distance table does not match the geometry', () => {
    expect(buildConsist({
      lineCoords: STRAIGHT, lineDists: [0, 1, 2], anchorArc: 100, direction: 1, zoom: 16,
    })).toEqual([]);
  });

  it('returns nothing without a finite anchor position', () => {
    for (const anchorArc of [undefined, null, NaN, Infinity]) {
      expect(build({ anchorArc, direction: 1 })).toEqual([]);
    }
  });
});

describe('MIN_CONSIST_ZOOM', () => {
  it('is high enough that the consist spans a readable distance', () => {
    // Four units at threshold spacing must cover more ground than one icon.
    const span = unitSpacingMeters(MIN_CONSIST_ZOOM) * (CONSIST_UNITS.length - 1);
    expect(span).toBeGreaterThan(unitSpacingMeters(MIN_CONSIST_ZOOM));
    expect(MIN_CONSIST_ZOOM).toBeGreaterThanOrEqual(13);
  });
});
