// Where to print a trail's name on the map: halfway along its longest line, so
// the label sits on the trail rather than at the POI's lat/lng, which may be an end.
function lineLength(line) {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  return total;
}

function linesOf(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

// Returns [lat, lng] for Leaflet, or null when the geometry has no usable line.
export function trailLabelPosition(geometry) {
  let longest = null;
  let longestLength = 0;
  for (const line of linesOf(geometry)) {
    const length = lineLength(line);
    if (length > longestLength) {
      longest = line;
      longestLength = length;
    }
  }
  if (!longest) return null;

  let remaining = longestLength / 2;
  for (let i = 1; i < longest.length; i++) {
    const [ax, ay] = longest[i - 1];
    const [bx, by] = longest[i];
    const segment = Math.hypot(bx - ax, by - ay);
    if (segment >= remaining && segment > 0) {
      const t = remaining / segment;
      return [ay + (by - ay) * t, ax + (bx - ax) * t];
    }
    remaining -= segment;
  }
  return null;
}
