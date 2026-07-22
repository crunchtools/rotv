import { snapAtArc, dualSnapBearing, metersPerPixel, bearingHalfSpan } from './trackInterpolation';

// The CVSR excursion consist, ordered from the GPS fix backwards: a lead
// engine, two Zephyr coaches, and a second engine on the tail. The tail engine
// is dragged backwards rather than turned, which is how the railroad actually
// works the return leg — hence `flip`.
export const CONSIST_UNITS = [
  { key: 'lead', kind: 'engine', flip: false },
  { key: 'car-1', kind: 'zephyr', flip: false },
  { key: 'car-2', kind: 'zephyr', flip: false },
  { key: 'rear', kind: 'engine', flip: true },
];

// Below this zoom the entire consist spans fewer pixels than a single icon, so
// the four markers pile into an unreadable blob — the lead engine renders
// alone instead (the spec 038 behavior).
export const MIN_CONSIST_ZOOM = 14;

// Prototype length of a Budd Zephyr coach. This floor is only ever reached
// past z18, where a pixel is under half a meter — see UNIT_GAP_PX.
const TRUE_CAR_LENGTH_M = 25;

// On-screen distance between unit centers. The icon bodies are ~54px long, so
// 50px reads as a coupled train rather than a convoy of separate objects.
const UNIT_GAP_PX = 50;

// The consist icons are 64px boxes, same as the lead engine marker.
const ICON_HALF_PX = 32;

/**
 * Ground distance between consist units.
 *
 * True-to-scale spacing is unusable at the zooms people actually browse at: a
 * 25m car gap is 3.5 pixels at z14, so the consist would render as one opaque
 * pile. Spacing therefore tracks the icons' on-screen size, which keeps the
 * train's apparent length constant as the user zooms, and only falls back to
 * prototype length once a pixel is small enough for the two to agree (~z18).
 *
 * @param {number} zoom Leaflet zoom level
 * @returns {number} meters between adjacent unit centers
 */
export function unitSpacingMeters(zoom) {
  return Math.max(TRUE_CAR_LENGTH_M, UNIT_GAP_PX * metersPerPixel(zoom));
}

/**
 * Place the train consist along the track behind a lead engine.
 *
 * Every unit is resolved independently against the line geometry, so the
 * consist bends through curves instead of holding a rigid straight bar, and
 * each unit's bearing comes from the same dual-snap derivation the lead marker
 * uses — a unit in a curve faces its own local tangent, not the lead's.
 *
 * Index 0 is the lead engine itself. Callers rendering the lead from its own
 * tracker state want `.slice(1)`; it is returned so the trailing units can be
 * reasoned about (and tested) relative to the head of the train.
 *
 * @param {object} opts
 * @param {Array<[number, number]>} opts.lineCoords track geometry, GeoJSON [lng, lat]
 * @param {number[]} opts.lineDists lineCumulativeDistances(lineCoords)
 * @param {number} opts.leadArc lead engine's distance along the line, meters
 * @param {number} opts.direction travel direction along the line, +1 or -1
 * @param {number} opts.zoom current Leaflet zoom
 * @returns {Array<{key: string, kind: string, flip: boolean, position: [number, number], bearing: number}>}
 *   empty when the geometry or lead position is unusable
 */
export function buildConsist({ lineCoords, lineDists, leadArc, direction, zoom }) {
  if (!lineCoords || lineCoords.length < 2) return [];
  if (!lineDists || lineDists.length !== lineCoords.length) return [];
  if (!Number.isFinite(leadArc)) return [];

  const spacing = unitSpacingMeters(zoom);
  const halfSpan = bearingHalfSpan(zoom, ICON_HALF_PX);
  // Anything that isn't an explicit reverse is treated as running forward —
  // the hook leaves direction at +1 until travel disambiguates it.
  const dir = direction === -1 ? -1 : 1;

  return CONSIST_UNITS.map((unit, i) => {
    // Trailing units sit behind the lead along the direction of travel, so the
    // offset subtracts when running up the line and adds when running down it.
    // snapAtArc clamps, so a consist straddling either end of the track stacks
    // against the endpoint rather than vanishing.
    const snap = snapAtArc(lineCoords, lineDists, leadArc - dir * i * spacing);
    let bearing = dualSnapBearing(lineCoords, snap, halfSpan);
    if (dir === -1) bearing = (bearing + 180) % 360;
    if (unit.flip) bearing = (bearing + 180) % 360;
    return { ...unit, position: snap.position, bearing };
  });
}
