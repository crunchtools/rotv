/**
 * Group GeoJSON features by their `name` property and merge each group's
 * geometries into one: polygons into a MultiPolygon, lines into a
 * MultiLineString. Single-geometry groups are returned unchanged.
 *
 * @param {Array<{properties?: {name?: string}, geometry: {type: string, coordinates: Array}}>} features
 *   GeoJSON Feature objects; a missing name groups under 'Unnamed'.
 * @returns {Array<{name: string, geometry: {type: string, coordinates: Array}}>}
 *   One entry per distinct name, in first-seen order.
 */
export function consolidateFeatures(features) {
  const byName = {};
  for (const feature of features) {
    const name = feature.properties?.name || 'Unnamed';
    if (!byName[name]) byName[name] = [];
    byName[name].push(feature.geometry);
  }

  const consolidated = [];
  for (const [name, geometries] of Object.entries(byName)) {
    let geometry;
    if (geometries.length === 1) {
      geometry = geometries[0];
    } else {
      const firstType = geometries[0]?.type;
      if (firstType === 'Polygon' || firstType === 'MultiPolygon') {
        const allCoords = geometries.map(g =>
          g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
        ).flat();
        geometry = { type: 'MultiPolygon', coordinates: allCoords };
      } else {
        const allCoords = geometries.map(g =>
          g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
        ).flat();
        geometry = { type: 'MultiLineString', coordinates: allCoords };
      }
    }
    consolidated.push({ name, geometry });
  }
  return consolidated;
}
