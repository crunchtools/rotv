import L from 'leaflet';

const FRAME_PADDING = 60;
const MAX_FRAME_ZOOM = 16;
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

// The part of the map a visitor can see: on a phone the place card covers the
// bottom `coveredBottom` pixels.
function visibleView(map, coveredBottom) {
  const view = map.getBounds();
  if (!coveredBottom) return view;
  const south = map.containerPointToLatLng([0, map.getSize().y - coveredBottom]).lat;
  return L.latLngBounds([south, view.getWest()], [view.getNorth(), view.getEast()]);
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
 * @param {number} [options.coveredBottom=0] - Pixels at the bottom of the map
 *   hidden under the place card; the shape is framed in what is left.
 * @returns {boolean} Whether the map moved
 */
export function frameBounds(map, bounds, { animate = true, coveredBottom = 0 } = {}) {
  if (!bounds) return false;
  const target = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
  if (isComfortablyInView(visibleView(map, coveredBottom), target)) return false;

  map._isProgrammaticMove = true;
  const fit = {
    paddingTopLeft: [FRAME_PADDING, FRAME_PADDING],
    paddingBottomRight: [FRAME_PADDING, FRAME_PADDING + coveredBottom],
    maxZoom: MAX_FRAME_ZOOM
  };
  if (animate) map.flyToBounds(target, { ...fit, duration: FLY_SECONDS });
  else map.fitBounds(target, { ...fit, animate: false });

  setTimeout(() => {
    map._isProgrammaticMove = false;
    map._forceNextUpdate = true;
    map.fire('moveend');
  }, animate ? FLY_SECONDS * 1000 + 100 : 0);
  return true;
}
