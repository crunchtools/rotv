import L from 'leaflet';

const FRAME_OPTIONS = { padding: [60, 60], maxZoom: 16 };
const FLY_SECONDS = 0.6;

/**
 * Bring a line or polygon's bounds into view, unless all of it already is.
 *
 * The move is flagged _isProgrammaticMove, like the point fly in MapUpdater,
 * so its moveend does not recompute the visible-POI list mid-flight; one
 * forced update follows when it settles. Returns whether the map moved.
 *
 * @param {L.Map} map
 * @param {{south:number, west:number, north:number, east:number}|null} bounds
 */
export function frameBounds(map, bounds, { animate = true } = {}) {
  if (!bounds) return false;
  const target = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
  if (map.getBounds().contains(target)) return false;

  map._isProgrammaticMove = true;
  if (animate) map.flyToBounds(target, { ...FRAME_OPTIONS, duration: FLY_SECONDS });
  else map.fitBounds(target, { ...FRAME_OPTIONS, animate: false });

  setTimeout(() => {
    map._isProgrammaticMove = false;
    map._forceNextUpdate = true;
    map.fire('moveend');
  }, animate ? FLY_SECONDS * 1000 + 100 : 0);
  return true;
}
