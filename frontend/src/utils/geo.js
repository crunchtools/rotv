export function firstGeometryPoint(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;

  const { type, coordinates } = geometry;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

  let firstCoord = null;
  if (type === 'LineString') {
    firstCoord = coordinates[0];
  } else if (type === 'MultiLineString') {
    firstCoord = Array.isArray(coordinates[0]) ? coordinates[0][0] : null;
  } else {
    return null;
  }

  if (!Array.isArray(firstCoord) || firstCoord.length < 2) return null;
  const [lng, lat] = firstCoord;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  return { lat, lng };
}
