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

/** What a curated list's rows can be ordered by; each runs up or down. */
export const LIST_SORTS = [
  { id: 'trail', label: 'Trail' },
  { id: 'park', label: 'Park' },
  { id: 'difficulty', label: 'Difficulty' }
];

export const DEFAULT_LIST_SORT = 'trail';

// Easiest first. The organizer rates Easy / Moderate / Strenuous; our own trails say Difficult.
const RATING_RANK = { easy: 0, moderate: 1, strenuous: 2, difficult: 2 };
const UNRATED = 3;

/**
 * Split a stored sort such as `park-desc` into what it sorts by and which way.
 * @param {string} sort `<key>` for ascending, `<key>-desc` for descending
 * @returns {{key: string, descending: boolean}} An unknown key falls back to the default sort
 */
export function parseListSort(sort) {
  const descending = typeof sort === 'string' && sort.endsWith('-desc');
  const key = descending ? sort.slice(0, -'-desc'.length) : sort;
  return LIST_SORTS.some(known => known.id === key)
    ? { key, descending }
    : { key: DEFAULT_LIST_SORT, descending: false };
}

/**
 * The sort to store after a sort button is pressed: pressing the active one
 * turns it around, pressing another starts it ascending.
 * @param {string} current The stored sort
 * @param {string} key The button pressed
 * @returns {string}
 */
export function nextListSort(current, key) {
  const active = parseListSort(current);
  return active.key === key && !active.descending ? `${key}-desc` : key;
}

/**
 * Order a curated list's rows by the hike's name, by park and then name, or
 * by difficulty (rating, then the shorter hike first), up or down.
 *
 * @param {object[]} rows Rows from curatedListRows(), each with `_listItem` and, for the park order, `_park`
 * @param {string} sort A stored sort, as parseListSort() reads it
 * @returns {object[]} A new array
 */
export function sortListRows(rows, sort) {
  const { key, descending } = parseListSort(sort);
  const nameOf = (row) => row._listItem.label || row.name || '';
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
  const rank = (row) => RATING_RANK[(row._listItem.rating || '').toLowerCase()] ?? UNRATED;
  const miles = (row) => row._listItem.miles ?? Infinity;

  let compare = byName;
  if (key === 'park') compare = (a, b) => (a._park || '').localeCompare(b._park || '') || byName(a, b);
  if (key === 'difficulty') compare = (a, b) => rank(a) - rank(b) || miles(a) - miles(b) || byName(a, b);

  const sorted = [...rows].sort(compare);
  return descending ? sorted.reverse() : sorted;
}

/**
 * The trails a list's free choice may be: not already on the list, and in a
 * park the list's hikes are in or one its organizer owns.
 *
 * @param {{organizer_poi_id: number|null, items: {poi_id: number}[]}} list
 * @param {object[]} trails Every trail POI
 * @param {(poi: object) => ({id: number, owner_id?: number|null}|null)} parkOf The park a POI sits in
 * @param {object[]} listPois The POIs the list's items name
 * @returns {object[]} Sorted by name; every other trail when none qualifies, so a choice can always be made
 */
export function choiceCandidates(list, trails, parkOf, listPois) {
  const onList = new Set(list.items.map(item => String(item.poi_id)));
  const listParks = new Set(listPois.map(poi => parkOf(poi)?.id).filter(id => id != null));
  const organizer = list.organizer_poi_id;
  const others = trails.filter(trail => !onList.has(String(trail.id)));
  const eligible = others.filter(trail => {
    const park = parkOf(trail);
    return (organizer != null && trail.owner_id === organizer)
      || (park && (listParks.has(park.id) || (organizer != null && park.owner_id === organizer)));
  });
  return (eligible.length > 0 ? eligible : others).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * A trail to offer as the free choice before the person picks: one they have
 * favorited, else one drawn by `seed` so it holds still for the day.
 *
 * @param {object[]} candidates From choiceCandidates()
 * @param {number[]} favorites Favorited POI ids
 * @param {string} seed Anything stable for as long as the suggestion should be, e.g. today's date
 * @returns {object|null} Null when there is no candidate
 */
export function suggestChoice(candidates, favorites, seed) {
  if (candidates.length === 0) return null;
  const favorite = candidates.find(trail => favorites.includes(trail.id));
  if (favorite) return favorite;
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  return candidates[hash % candidates.length];
}

/**
 * The free choice as a row like any other hike on the list, carrying the
 * chosen trail's own length and difficulty.
 *
 * @param {{choice_label: string, choice_description: string|null}} list
 * @param {object} trail The trail chosen or suggested
 * @returns {object} A row whose `_listItem.id` is null and `_listItem.choice` true
 */
export function choiceRow(list, trail) {
  return {
    ...trail,
    _listItem: {
      id: null,
      choice: true,
      poi_id: trail.id,
      position: 'choice',
      label: trail.name,
      tag: list.choice_label,
      note: list.choice_description,
      miles: trail.length_miles == null ? null : Number(trail.length_miles),
      rating: trail.difficulty || null,
      trail_class: null,
      trailhead: null
    }
  };
}
