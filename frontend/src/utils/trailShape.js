/**
 * A trail's line as a small drawing, for a thumbnail where there is no photo.
 */

const MAX_POINTS = 240;

/**
 * An SVG path for a trail's geometry, scaled to fit a square with its shape kept.
 *
 * @param {{type: string, coordinates: Array}|null} geometry A GeoJSON LineString or MultiLineString
 * @param {number} [box=100] Side of the square to fit, in SVG units
 * @param {number} [pad=12] Space kept clear on every side
 * @returns {string|null} Path data, or null when there is no line to draw
 */
export function trailShapePath(geometry, box = 100, pad = 12) {
  const lines = (geometry?.type === 'LineString' ? [geometry.coordinates]
    : geometry?.type === 'MultiLineString' ? geometry.coordinates : [])
    .filter(line => Array.isArray(line) && line.length > 1);
  const points = lines.flat();
  if (points.length < 2) return null;

  // A degree of longitude is narrower than one of latitude this far north.
  const midLat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const squash = Math.cos((midLat * Math.PI) / 180);
  const eastings = points.map(point => point[0] * squash);
  const northings = points.map(point => point[1]);
  const west = Math.min(...eastings);
  const north = Math.max(...northings);
  const width = Math.max(...eastings) - west;
  const height = north - Math.min(...northings);
  const scale = (box - 2 * pad) / (Math.max(width, height) || 1);
  const leftMargin = (box - width * scale) / 2;
  const topMargin = (box - height * scale) / 2;

  // A long trail has thousands of points; a thumbnail needs a few hundred.
  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  return lines.map(line => {
    const kept = line.filter((_, index) => index % step === 0 || index === line.length - 1);
    return kept.map((point, index) => {
      const across = (point[0] * squash - west) * scale + leftMargin;
      const down = (north - point[1]) * scale + topMargin;
      return `${index === 0 ? 'M' : 'L'}${across.toFixed(1)} ${down.toFixed(1)}`;
    }).join('');
  }).join('');
}
