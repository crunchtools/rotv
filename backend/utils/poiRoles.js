/**
 * Which POIs count as places we collect content for.
 *
 * A park is a single POI carrying the 'boundary' role (spec 048), so a gate
 * that used to accept only point POIs must also accept a park boundary.
 * Municipal, county and state boundaries stay out. SQL that applies the same
 * rule spells it out: 'boundary' = ANY(poi_roles) AND boundary_type = 'park'.
 */

const COLLECTIBLE_ROLES = ['point', 'organization', 'river'];

/**
 * @param {{poi_roles?: string[], boundary_type?: string}|null} poi
 * @returns {boolean} Whether news and events are collected for this POI
 */
export function isCollectiblePoi(poi) {
  if (!poi) return false;
  const roles = poi.poi_roles || [];
  const isPark = roles.includes('boundary') && poi.boundary_type === 'park';
  return isPark || roles.some(r => COLLECTIBLE_ROLES.includes(r));
}
