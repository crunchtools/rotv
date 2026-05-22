import { firstGeometryPoint } from '../../utils/geo';

export function getNavigationStops(poi, isLinearFeature) {
  if (!poi) return null;

  const navLat = poi.navigation_latitude != null ? Number(poi.navigation_latitude) : null;
  const navLng = poi.navigation_longitude != null ? Number(poi.navigation_longitude) : null;
  if (Number.isFinite(navLat) && Number.isFinite(navLng)) {
    return [{ lat: navLat, lng: navLng }];
  }

  if (isLinearFeature) {
    if (poi.poi_roles?.includes('trail')) {
      const point = firstGeometryPoint(poi.geometry);
      return point ? [point] : null;
    }
    return null;
  }

  const lat = poi.latitude != null ? Number(poi.latitude) : null;
  const lng = poi.longitude != null ? Number(poi.longitude) : null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return [{ lat, lng }];
  }
  return null;
}

export function getOwnerClass(owner) {
  if (!owner) return 'owner-other';
  const ownerLower = owner.toLowerCase();
  if (ownerLower.includes('federal') || ownerLower.includes('nps')) return 'owner-federal';
  if (ownerLower.includes('private')) return 'owner-private';
  if (ownerLower.includes('local') || ownerLower.includes('metro') || ownerLower.includes('county')) return 'owner-local';
  return 'owner-other';
}

export function formatCoordinate(value, type) {
  if (value === null || value === undefined) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return '';
  const absVal = Math.abs(num).toFixed(4);
  if (type === 'lat') {
    return `${absVal}° ${num >= 0 ? 'N' : 'S'}`;
  } else {
    return `${absVal}° ${num >= 0 ? 'E' : 'W'}`;
  }
}

export function generateSlug(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
