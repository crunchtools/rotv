import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import { frameBounds } from './mapFrame';

function fakeMap(view) {
  return {
    getBounds: () => L.latLngBounds(view[0], view[1]),
    flyToBounds: vi.fn(),
    fitBounds: vi.fn(),
    fire: vi.fn()
  };
}

const PARK = { south: 41.25, west: -81.65, north: 41.27, east: -81.62 };
const VIEW_ELSEWHERE = [[41.10, -81.55], [41.15, -81.50]];
const VIEW_AROUND_PARK = [[41.23, -81.67], [41.29, -81.60]];
const VIEW_WHOLE_REGION = [[40.90, -82.00], [41.60, -81.30]];

describe('frameBounds', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does nothing without bounds', () => {
    const map = fakeMap(VIEW_ELSEWHERE);
    expect(frameBounds(map, null)).toBe(false);
    expect(map.flyToBounds).not.toHaveBeenCalled();
  });

  it('zooms to a shape that is on screen but only a speck', () => {
    const map = fakeMap(VIEW_WHOLE_REGION);
    expect(frameBounds(map, PARK)).toBe(true);
    expect(map.flyToBounds).toHaveBeenCalledTimes(1);
  });

  it('leaves the map alone when the whole shape is in view at a readable size', () => {
    const map = fakeMap(VIEW_AROUND_PARK);
    expect(frameBounds(map, PARK)).toBe(false);
    expect(map.flyToBounds).not.toHaveBeenCalled();
    expect(map._isProgrammaticMove).toBeUndefined();
  });

  it('flies to a shape that is out of view, then reports the move once', () => {
    const map = fakeMap(VIEW_ELSEWHERE);
    expect(frameBounds(map, PARK)).toBe(true);
    expect(map.flyToBounds).toHaveBeenCalledTimes(1);
    expect(map._isProgrammaticMove).toBe(true);
    expect(map.fire).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(map._isProgrammaticMove).toBe(false);
    expect(map._forceNextUpdate).toBe(true);
    expect(map.fire).toHaveBeenCalledWith('moveend');
  });

  it('jumps without animation when asked', () => {
    const map = fakeMap(VIEW_ELSEWHERE);
    frameBounds(map, PARK, { animate: false });
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    expect(map.fitBounds.mock.calls[0][1]).toMatchObject({ animate: false });
    expect(map.flyToBounds).not.toHaveBeenCalled();
  });

  it('frames the shape in what a phone place card leaves visible', () => {
    const [[south], [north]] = VIEW_AROUND_PARK;
    const map = {
      ...fakeMap(VIEW_AROUND_PARK),
      getSize: () => ({ x: 390, y: 600 }),
      containerPointToLatLng: ([, y]) => ({ lat: north - ((north - south) * y) / 600 })
    };
    // On screen, but the card hides the lower half, where part of the park is
    expect(frameBounds(map, PARK, { coveredBottom: 300 })).toBe(true);
    expect(map.flyToBounds.mock.calls[0][1]).toMatchObject({
      paddingTopLeft: [60, 60],
      paddingBottomRight: [60, 360]
    });
  });
});
