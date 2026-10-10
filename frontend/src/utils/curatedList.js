/**
 * Rows for a curated list in Find (spec 050).
 */

/**
 * A list's items as Find rows: the organizer's order, each POI carrying its
 * item and the item's trailhead as its navigation coordinates. The search is
 * matched item by item, so two entries for one place keep their own labels.
 *
 * @param {{items: object[]}} list A list from /api/lists
 * @param {object[]} pois Every POI the list may name
 * @param {string} [search=''] Lower-cased search text; empty matches everything
 * @returns {object[]} One row per matching item whose POI is known
 */
export function curatedListRows(list, pois, search = '') {
  const wanted = new Set(list.items.map(item => String(item.poi_id)));
  const byId = new Map(pois.filter(poi => wanted.has(String(poi.id))).map(poi => [String(poi.id), poi]));
  const matches = (item, poi) => !search || [item.label, poi.name, poi.brief_description, poi.primary_activities]
    .some(text => (text || '').toLowerCase().includes(search));

  const rows = [];
  for (const item of list.items) {
    const poi = byId.get(String(item.poi_id));
    if (!poi || !matches(item, poi)) continue;
    const hasTrailhead = item.nav_latitude != null && item.nav_longitude != null;
    rows.push({
      ...poi,
      navigation_latitude: hasTrailhead ? item.nav_latitude : poi.navigation_latitude,
      navigation_longitude: hasTrailhead ? item.nav_longitude : poi.navigation_longitude,
      _listItem: item
    });
  }
  return rows;
}
