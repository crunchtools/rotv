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

/** How a curated list's rows can be ordered. */
export const LIST_SORTS = [
  { id: 'official', label: 'Official order' },
  { id: 'trail', label: 'Trail, A to Z' },
  { id: 'park', label: 'Park, A to Z' }
];

/**
 * Order a curated list's rows: as the organizer lists them, by the hike's
 * name, or by park and then name.
 *
 * @param {object[]} rows Rows from curatedListRows(), each with `_listItem` and, for the park order, `_park`
 * @param {'official'|'trail'|'park'} sort
 * @returns {object[]} A new array; an unknown `sort` leaves the organizer's order
 */
export function sortListRows(rows, sort) {
  const nameOf = (row) => row._listItem.label || row.name || '';
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
  if (sort === 'trail') return [...rows].sort(byName);
  if (sort === 'park') return [...rows].sort((a, b) => (a._park || '').localeCompare(b._park || '') || byName(a, b));
  return [...rows];
}

