import { describe, it, expect } from 'vitest';
import { trailShapePath } from './trailShape';

const numbers = (path) => path.match(/-?\d+(\.\d+)?/g).map(Number);

describe('trailShapePath', () => {
  it('fits a line inside the padded square, north up', () => {
    const path = trailShapePath({ type: 'LineString', coordinates: [[-81.6, 41.2], [-81.5, 41.3]] });

    expect(path.startsWith('M')).toBe(true);
    expect(numbers(path).every(n => n >= 12 && n <= 88)).toBe(true);
    const [, startY, , endY] = numbers(path);
    expect(endY).toBeLessThan(startY);
  });

  it('centers a line that is longer one way than the other', () => {
    const [x1, y1, x2, y2] = numbers(trailShapePath({ type: 'LineString', coordinates: [[-81.6, 41.2], [-81.6, 41.3]] }));
    expect(x1).toBe(50);
    expect(x2).toBe(50);
    expect([y1, y2]).toEqual([88, 12]);
  });

  it('draws each part of a trail in pieces as its own stroke', () => {
    const path = trailShapePath({
      type: 'MultiLineString',
      coordinates: [[[-81.6, 41.2], [-81.59, 41.21]], [[-81.58, 41.22], [-81.57, 41.23]]]
    });
    expect(path.match(/M/g)).toHaveLength(2);
  });

  it('thins a very long trail but keeps its ends', () => {
    const coordinates = Array.from({ length: 5000 }, (_, i) => [-81.6 + i * 0.0001, 41.2 + Math.sin(i / 50) * 0.01]);
    const path = trailShapePath({ type: 'LineString', coordinates });
    expect(path.match(/[ML]/g).length).toBeLessThan(300);
    expect(numbers(path).slice(-2)[0]).toBeCloseTo(88, 0);
  });

  it('has nothing to draw for a place with no line', () => {
    expect(trailShapePath(null)).toBeNull();
    expect(trailShapePath({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 1], [0, 0]]] })).toBeNull();
    expect(trailShapePath({ type: 'LineString', coordinates: [[-81.6, 41.2]] })).toBeNull();
  });
});
