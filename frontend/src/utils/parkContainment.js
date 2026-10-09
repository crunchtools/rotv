/**
 * Which park a place sits in (spec 048), worked out in the browser from the
 * park outlines the app already holds. A point POI uses its coordinates and a
 * trail or river its first point. When parks nest, the smallest one wins.
 */

import { firstGeometryPoint } from './geo';

function ringContains(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonsOf(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/**
 * Prepare park outlines for repeated lookups.
 * @param {object[]} pois Any POIs; only park boundaries with a polygon are kept
 * @returns {{id: number, name: string, polygons: number[][][][], box: number[], area: number}[]} Smallest first
 */
export function buildParkIndex(pois) {
  const parks = [];
  for (const poi of pois || []) {
    if (!poi.poi_roles?.includes('boundary') || poi.boundary_type !== 'park') continue;
    const polygons = polygonsOf(poi.geometry);
    if (polygons.length === 0) continue;
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const rings of polygons) {
      for (const [lng, lat] of rings[0] || []) {
        west = Math.min(west, lng); east = Math.max(east, lng);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
    }
    if (west === Infinity) continue;
    parks.push({ id: poi.id, name: poi.name, polygons, box: [west, south, east, north], area: (east - west) * (north - south) });
  }
  return parks.sort((a, b) => a.area - b.area);
}

/**
 * @param {object} poi A point POI, trail or river
 * @param {ReturnType<typeof buildParkIndex>} parkIndex
 * @returns {{id: number, name: string}|null} The smallest park containing it, never the POI itself
 */
export function findContainingPark(poi, parkIndex) {
  const at = poi.geometry
    ? firstGeometryPoint(poi.geometry)
    : { lat: parseFloat(poi.latitude), lng: parseFloat(poi.longitude) };
  if (!at || Number.isNaN(at.lat) || Number.isNaN(at.lng)) return null;
  for (const park of parkIndex) {
    if (park.id === poi.id) continue;
    const [west, south, east, north] = park.box;
    if (at.lng < west || at.lng > east || at.lat < south || at.lat > north) continue;
    // Inside a polygon's outer ring and outside every hole
    const isInside = park.polygons.some(rings =>
      rings.length > 0
      && ringContains(rings[0], at.lng, at.lat)
      && !rings.slice(1).some(hole => ringContains(hole, at.lng, at.lat)));
    if (isInside) {
      return { id: park.id, name: park.name };
    }
  }
  return null;
}
