/**
 * A park is a single POI carrying the 'boundary' role (spec 048). It has an
 * outline like any boundary, and when it also carries coordinates it gets a
 * map pin like any destination.
 */
export function isParkPin(poi) {
  return !!poi
    && !!poi.poi_roles?.includes('boundary')
    && poi.boundary_type === 'park'
    && poi.latitude != null
    && poi.longitude != null;
}
