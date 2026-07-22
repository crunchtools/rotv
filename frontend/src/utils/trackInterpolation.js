/**
 * Great-circle distance between two points.
 * @param {number} lat1 @param {number} lng1 first point, decimal degrees
 * @param {number} lat2 @param {number} lng2 second point, decimal degrees
 * @returns {number} distance in meters
 */
export function haversineDist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cumulative meters from the line start to each vertex.
 * @param {Array<[number, number]>} lineCoords GeoJSON [lng, lat] pairs
 *   (unlike interpolation paths, which are [lat, lng])
 * @returns {number[]} one entry per vertex; [0] is 0, last is total length
 */
export function lineCumulativeDistances(lineCoords) {
  const dists = [0];
  for (let i = 1; i < lineCoords.length; i++) {
    dists.push(dists[i - 1] + haversineDist(
      lineCoords[i - 1][1], lineCoords[i - 1][0],
      lineCoords[i][1], lineCoords[i][0]
    ));
  }
  return dists;
}

/**
 * Arc position (meters along the line) of a snapToLine() result. Travel
 * direction is the SIGN of the arc delta between two snaps — unlike comparing
 * a GPS displacement angle to the track bearing, it cannot be flipped by the
 * perpendicular raw-vs-snapped offset.
 * @param {number[]} lineDists lineCumulativeDistances(lineCoords)
 * @param {{segmentIndex: number, segmentT: number}} snap snapToLine() result
 * @returns {number} meters from the line start
 */
export function arcDistanceAt(lineDists, snap) {
  const i = snap.segmentIndex;
  return lineDists[i] + snap.segmentT * (lineDists[i + 1] - lineDists[i]);
}

function segmentBearing(p1, p2) {
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const rlat1 = p1[0] * Math.PI / 180;
  const rlat2 = p2[0] * Math.PI / 180;
  const eastward = Math.sin(dLon) * Math.cos(rlat2);
  const northward = Math.cos(rlat1) * Math.sin(rlat2) - Math.sin(rlat1) * Math.cos(rlat2) * Math.cos(dLon);
  return ((Math.atan2(eastward, northward) * 180 / Math.PI) + 360) % 360;
}

export function walkAlongTrack(lineCoords, snap, distMeters) {
  const si = snap.segmentIndex;
  const startPt = snap.position;

  if (distMeters >= 0) {
    const segEnd = [lineCoords[si + 1][1], lineCoords[si + 1][0]];
    const distToSegEnd = haversineDist(startPt[0], startPt[1], segEnd[0], segEnd[1]);
    if (distMeters <= distToSegEnd) {
      const frac = distToSegEnd === 0 ? 0 : distMeters / distToSegEnd;
      return [
        startPt[0] + frac * (segEnd[0] - startPt[0]),
        startPt[1] + frac * (segEnd[1] - startPt[1]),
      ];
    }
    let remaining = distMeters - distToSegEnd;
    for (let i = si + 1; i < lineCoords.length - 1; i++) {
      const p1 = [lineCoords[i][1], lineCoords[i][0]];
      const p2 = [lineCoords[i + 1][1], lineCoords[i + 1][0]];
      const segLen = haversineDist(p1[0], p1[1], p2[0], p2[1]);
      if (remaining <= segLen) {
        const frac = segLen === 0 ? 0 : remaining / segLen;
        return [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1])];
      }
      remaining -= segLen;
    }
    const last = lineCoords[lineCoords.length - 1];
    return [last[1], last[0]];
  } else {
    const segStart = [lineCoords[si][1], lineCoords[si][0]];
    const distToSegStart = haversineDist(startPt[0], startPt[1], segStart[0], segStart[1]);
    const absDist = -distMeters;
    if (absDist <= distToSegStart) {
      const frac = distToSegStart === 0 ? 0 : absDist / distToSegStart;
      return [
        startPt[0] + frac * (segStart[0] - startPt[0]),
        startPt[1] + frac * (segStart[1] - startPt[1]),
      ];
    }
    let remaining = absDist - distToSegStart;
    for (let i = si - 1; i >= 0; i--) {
      const p1 = [lineCoords[i + 1][1], lineCoords[i + 1][0]];
      const p2 = [lineCoords[i][1], lineCoords[i][0]];
      const segLen = haversineDist(p1[0], p1[1], p2[0], p2[1]);
      if (remaining <= segLen) {
        const frac = segLen === 0 ? 0 : remaining / segLen;
        return [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1])];
      }
      remaining -= segLen;
    }
    const first = lineCoords[0];
    return [first[1], first[0]];
  }
}

/**
 * Point on the line at a given arc distance from its start. O(log n) binary
 * search over the cumulative-distance table, cheap enough to run every
 * animation frame — unlike re-snapping a lat/lng against the full geometry.
 * @param {Array<[number, number]>} lineCoords GeoJSON [lng, lat] vertices
 * @param {number[]} lineDists lineCumulativeDistances(lineCoords)
 * @param {number} arcMeters distance along the line; clamped to [0, total]
 * @returns {{position: [number, number], segmentIndex: number, segmentT: number, bearing: number}}
 *   same shape as snapToLine() (position is [lat, lng])
 */
export function snapAtArc(lineCoords, lineDists, arcMeters) {
  const total = lineDists[lineDists.length - 1];
  const arc = Math.max(0, Math.min(total, arcMeters));
  let lo = 0;
  let hi = lineDists.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lineDists[mid] <= arc) lo = mid; else hi = mid;
  }
  const segLen = lineDists[lo + 1] - lineDists[lo];
  const segmentT = segLen === 0 ? 0 : (arc - lineDists[lo]) / segLen;
  const [lng1, lat1] = lineCoords[lo];
  const [lng2, lat2] = lineCoords[lo + 1];
  return {
    position: [lat1 + segmentT * (lat2 - lat1), lng1 + segmentT * (lng2 - lng1)],
    segmentIndex: lo,
    segmentT,
    bearing: segmentBearing([lat1, lng1], [lat2, lng2]),
  };
}

export function dualSnapBearing(lineCoords, snap, halfDistMeters) {
  const front = walkAlongTrack(lineCoords, snap, halfDistMeters);
  const back = walkAlongTrack(lineCoords, snap, -halfDistMeters);
  return segmentBearing(back, front);
}

// Every tracker on this map runs through the Cuyahoga Valley, so ground
// resolution is computed at one representative latitude rather than per-fix —
// the difference across the valley's ~0.5° span is under 1%.
const VALLEY_LAT = 41.26;

/**
 * Web Mercator ground resolution at the valley's latitude.
 * @param {number} zoom Leaflet zoom level
 * @returns {number} meters per screen pixel
 */
export function metersPerPixel(zoom) {
  return 156543.03 * Math.cos(VALLEY_LAT * Math.PI / 180) / (2 ** (zoom || 13));
}

// At wide zooms the icon's ground footprint spans kilometers of track, and a
// chord that long cuts across curves — the icon reads visibly crooked against
// the track line under it (14° off at z11 near the CVSR yard), then rotates
// into place as the zoom shrinks the span (#554). The eye judges alignment
// against the LOCAL track direction, so cap the span; below the cap the
// zoom-scaled footprint behavior is unchanged.
const MAX_BEARING_SPAN_M = 150;

/**
 * Half the ground distance to span when deriving an icon's bearing: the icon's
 * own footprint at this zoom, capped so the chord stays locally tangent.
 * @param {number} zoom Leaflet zoom level
 * @param {number} iconHalfPx half the icon's on-screen length, in pixels
 * @returns {number} meters
 */
export function bearingHalfSpan(zoom, iconHalfPx) {
  return Math.min(iconHalfPx * metersPerPixel(zoom), MAX_BEARING_SPAN_M);
}
