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
  const xs = points.map(point => point[0] * squash);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  const span = Math.max(Math.max(...xs) - minX, maxY - Math.min(...ys)) || 1;
  const scale = (box - 2 * pad) / span;
  const offsetX = (box - (Math.max(...xs) - minX) * scale) / 2;
  const offsetY = (box - (maxY - Math.min(...ys)) * scale) / 2;

  // A long trail has thousands of points; a thumbnail needs a few hundred.
  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  return lines.map(line => {
    const kept = line.filter((_, index) => index % step === 0 || index === line.length - 1);
    return kept.map((point, index) => {
      const x = (point[0] * squash - minX) * scale + offsetX;
      const y = (maxY - point[1]) * scale + offsetY;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join('');
  }).join('');
}
