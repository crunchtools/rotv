/**
 * Order search results in the Find tab (spec 048): the place a visitor means
 * to drive to comes before the trail segments and restrooms that share its
 * name. Without a query the list is alphabetical.
 */

const AMENITY_RE = /\b(restrooms?|playground|parking|drinking fountain|water fountain)\b/i;

const TIER_PARK = 0;
const TIER_DESTINATION = 1;
const TIER_LINE = 2;
const TIER_AMENITY = 3;

/**
 * @param {object[]} pois Already filtered to the ones that match
 * @param {string} [query] The search text; empty means no ranking
 * @returns {object[]} A new array, best match first
 */
export function rankPois(pois, query) {
  const q = (query || '').trim().toLowerCase();
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  if (!q) return [...pois].sort(byName);

  const keyed = pois.map(poi => {
    const name = (poi.name || '').toLowerCase();
    // 0 exact name, 1 name starts with the query, 2 name contains it, 3 matched elsewhere
    const match = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3;

    // Park, then destination or organization, then trail/river/other outline, then amenity
    let tier = TIER_DESTINATION;
    if (poi.poi_roles?.includes('boundary') && poi.boundary_type === 'park') tier = TIER_PARK;
    else if (poi.geometry) tier = TIER_LINE;
    else if (AMENITY_RE.test(poi.name || '')) tier = TIER_AMENITY;

    return { poi, exact: match === 0 ? 0 : 1, tier, match };
  });
  keyed.sort((a, b) =>
    a.exact - b.exact || a.tier - b.tier || a.match - b.match || byName(a.poi, b.poi));
  return keyed.map(k => k.poi);
}
