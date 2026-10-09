import L from 'leaflet';

const FRAME_OPTIONS = { padding: [60, 60], maxZoom: 16 };
const FLY_SECONDS = 0.6;
// A shape counts as "in view" only when it is on screen and big enough to
// make out: at least this share of the view's width or height.
const MIN_SHARE_OF_VIEW = 0.25;

function isComfortablyInView(view, target) {
  if (!view.contains(target)) return false;
  const latShare = (target.getNorth() - target.getSouth()) / (view.getNorth() - view.getSouth());
  const lngShare = (target.getEast() - target.getWest()) / (view.getEast() - view.getWest());
  return Math.max(latShare, lngShare) >= MIN_SHARE_OF_VIEW;
}

/**
 * Bring a line or polygon's bounds into view, unless it is already on screen
 * at a readable size. A park that is a speck on a region-wide view is zoomed to.
 *
 * The move is flagged _isProgrammaticMove, like the point fly in MapUpdater,
 * so its moveend does not recompute the visible-POI list mid-flight; one
 * forced update follows when it settles. Returns whether the map moved.
 *
 * @param {L.Map} map
 * @param {{south:number, west:number, north:number, east:number}|null} bounds
 * @param {object} [options]
 * @param {boolean} [options.animate=true] - Fly there; false jumps at once
 *   (used when the map was hidden and there is nothing to watch).
 * @returns {boolean} Whether the map moved
 */
export function frameBounds(map, bounds, { animate = true } = {}) {
  if (!bounds) return false;
  const target = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
  if (isComfortablyInView(map.getBounds(), target)) return false;

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
