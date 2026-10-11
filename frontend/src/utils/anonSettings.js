/**
 * LocalStorage-backed customizations for anonymous (not-logged-in) visitors.
 * On first successful sign-in, syncAnonSettings() POSTs accumulated state to
 * /api/user/settings/sync (server-wins fill-gaps) and clears synced keys.
 * See .specify/specs/018-anon-user-settings/ for the architecture.
 */

const KEY_TIMEZONE = 'app-timezone';
const KEY_NEWSLETTER_EMAIL = 'rotv-newsletter-email';
const KEY_NEWSLETTER_SUBSCRIBED = 'rotv-newsletter-subscribed';
const KEY_SAVED_TRIPS = 'rotv-saved-trips';
const KEY_FAVORITES = 'rotv-favorites';
const KEY_VISITED = 'rotv-visited';
const KEY_LIST_CHECKINS = 'rotv-list-checkins';
const KEY_LIST_SORT = 'rotv-list-sort';
const KEY_LIST_CHOICES = 'rotv-list-choices';

function safeRead(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn(`[anonSettings] localStorage read of ${key} failed:`, err);
    return null;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
}

/**
 * Remove every ROTV key this module manages. Used after account deletion so
 * nothing personal is left behind on the device either.
 */
export function clearAnonSettings() {
  [KEY_TIMEZONE, KEY_NEWSLETTER_EMAIL, KEY_NEWSLETTER_SUBSCRIBED, KEY_SAVED_TRIPS, KEY_FAVORITES, KEY_VISITED,
    KEY_LIST_CHECKINS, KEY_LIST_SORT, KEY_LIST_CHOICES]
    .forEach(safeRemove);
}

export function readEmail() {
  return safeRead(KEY_NEWSLETTER_EMAIL) || '';
}

export function writeEmail(value) {
  safeWrite(KEY_NEWSLETTER_EMAIL, value);
}

export function writeSubscribed(value) {
  safeWrite(KEY_NEWSLETTER_SUBSCRIBED, value ? 'true' : 'false');
}

// A stored JSON array, or [] when the key is unset or does not hold one.
function readArray(key) {
  const raw = safeRead(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[anonSettings] ${key} is not valid JSON; ignoring it:`, err);
    return [];
  }
}

export function readTrips() {
  return readArray(KEY_SAVED_TRIPS);
}

function writeTrips(trips) {
  safeWrite(KEY_SAVED_TRIPS, JSON.stringify(trips));
}

export function addTrip(trip) {
  const trips = readTrips().filter(t => t.slug !== trip.slug);
  trips.push({ ...trip, savedAt: new Date().toISOString() });
  writeTrips(trips);
}

export function removeTrip(slug) {
  writeTrips(readTrips().filter(t => t.slug !== slug));
}

/**
 * Factory for an anonymous "array of POI ids" localStorage collection — the
 * canonical local-first user-data primitive. Returns read/write/add/remove
 * bound to one storage key. Favorites and Visited (and any future POI-id list)
 * share this so the next user feature is a one-liner, not a copy-paste.
 * See docs/USER_DATA_FRAMEWORK.md.
 */
export function createPoiIdListStore(key) {
  const read = () => readArray(key).filter(n => Number.isInteger(n));
  const write = (poiIds) => safeWrite(key, JSON.stringify(poiIds));
  const add = (poiId) => {
    const ids = read();
    if (!ids.includes(poiId)) write([...ids, poiId]);
  };
  const remove = (poiId) => write(read().filter(id => id !== poiId));
  return { read, write, add, remove };
}

const favoritesStore = createPoiIdListStore(KEY_FAVORITES);
export const readFavorites = favoritesStore.read;
export const addFavorite = favoritesStore.add;
export const removeFavorite = favoritesStore.remove;

const visitedStore = createPoiIdListStore(KEY_VISITED);
export const readVisited = visitedStore.read;
export const addVisited = visitedStore.add;
export const removeVisited = visitedStore.remove;

/**
 * Check-ins against curated lists (spec 050), as `{ list_id, item_id, poi_id,
 * done_on }`; `item_id` null is the list's free choice. One per list item.
 */
const sameCheckin = (a, b) => a.list_id === b.list_id && (a.item_id ?? null) === (b.item_id ?? null);

export function readListCheckins() {
  return readArray(KEY_LIST_CHECKINS).filter(c => c && Number.isInteger(c.list_id) && typeof c.done_on === 'string');
}

export function putListCheckin(checkin) {
  safeWrite(KEY_LIST_CHECKINS, JSON.stringify([...readListCheckins().filter(c => !sameCheckin(c, checkin)), checkin]));
}

export function removeListCheckin(listId, itemId) {
  const gone = { list_id: listId, item_id: itemId };
  safeWrite(KEY_LIST_CHECKINS, JSON.stringify(readListCheckins().filter(c => !sameCheckin(c, gone))));
}

/**
 * How the person last sorted a curated list on this device (spec 050).
 * @returns {string|null} A sort as parseListSort() reads it; null until they choose
 */
export function readListSort() {
  return safeRead(KEY_LIST_SORT);
}

/**
 * Remember on this device how the person sorts a curated list.
 * @param {string} sort A sort as parseListSort() reads it (utils/curatedList.js): `park`, `park-desc`, …
 */
export function writeListSort(sort) {
  safeWrite(KEY_LIST_SORT, sort);
}

/**
 * The trail picked for each list's free choice before it is hiked (spec 050).
 * @returns {Object<string, number>} `{ listId: poiId }`; empty until one is picked
 */
export function readListChoices() {
  const raw = safeRead(KEY_LIST_CHOICES);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn(`[anonSettings] ${KEY_LIST_CHOICES} is not valid JSON; ignoring it:`, err);
    return {};
  }
}

/**
 * Remember on this device the trails picked for lists' free choices.
 * @param {Object<string, number>} choices `{ listId: poiId }`, the whole set
 */
export function writeListChoices(choices) {
  safeWrite(KEY_LIST_CHOICES, JSON.stringify(choices));
}

/**
 * Follow POI merges: when a saved or visited place was folded into another
 * (duplicate park cleanup, spec 048), rewrite the stored id to the survivor so
 * it does not silently drop off the list. Resolves true when anything changed.
 */
export async function remapMergedPoiIds() {
  const stores = [favoritesStore, visitedStore];
  const held = [...new Set(stores.flatMap(store => store.read()))];
  if (held.length === 0) return false;
  try {
    const res = await fetch(`/api/pois/merged?ids=${held.join(',')}`);
    if (!res.ok) return false;
    const mergedInto = await res.json();
    if (Object.keys(mergedInto).length === 0) return false;
    for (const store of stores) {
      store.write([...new Set(store.read().map(id => mergedInto[id] ?? id))]);
    }
    return true;
  } catch (err) {
    console.warn('[anonSettings] could not check for merged places:', err);
    return false;
  }
}

/**
 * Flush accumulated anonymous state to the backend on first successful
 * sign-in. Server-wins semantics: the backend only fills a NULL timezone and
 * only inserts newsletter subscriptions / trips that don't already exist for
 * the user. Safe to call repeatedly — a no-op when no anon state is present.
 *
 * The timezone key is intentionally NOT cleared after sync: the logged-in
 * client (GeneralSettings) still reads timezone from localStorage. The server
 * column is canonical for future cross-device use, but the client does not yet
 * refetch it, so clearing here would drop the user's timezone.
 */
export async function syncAnonSettings() {
  const timezone = safeRead(KEY_TIMEZONE);
  const email = safeRead(KEY_NEWSLETTER_EMAIL) || '';
  const subscribed = safeRead(KEY_NEWSLETTER_SUBSCRIBED) === 'true';
  const trips = readTrips();
  const favorites = readFavorites();
  const visited = readVisited();
  const listCheckins = readListCheckins();
  const listSort = readListSort();
  const listChoices = readListChoices();
  const hasChoices = Object.keys(listChoices).length > 0;

  const hasState = timezone || (email && subscribed) || trips.length > 0
    || favorites.length > 0 || visited.length > 0 || listCheckins.length > 0 || listSort || hasChoices;
  if (!hasState) return { synced: false };

  const payload = {};
  if (timezone) payload.timezone = timezone;
  if (email && subscribed) payload.newsletter = { email, subscribed };
  if (trips.length > 0) payload.trips = trips;
  if (favorites.length > 0) payload.favorites = favorites;
  if (visited.length > 0) payload.visited = visited;
  if (listCheckins.length > 0) payload.listCheckins = listCheckins;
  // Like the timezone, these stay on the device after syncing: they are read from there too.
  if (listSort || hasChoices) {
    payload.preferences = { ...(listSort ? { listSort } : {}), ...(hasChoices ? { listChoices } : {}) };
  }

  try {
    const res = await fetch('/api/user/settings/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!res.ok) return { synced: false, status: res.status };

    if (email && subscribed) {
      safeRemove(KEY_NEWSLETTER_EMAIL);
      safeRemove(KEY_NEWSLETTER_SUBSCRIBED);
    }
    if (trips.length > 0) {
      safeRemove(KEY_SAVED_TRIPS);
    }
    if (favorites.length > 0) {
      safeRemove(KEY_FAVORITES);
    }
    if (visited.length > 0) {
      safeRemove(KEY_VISITED);
    }
    if (listCheckins.length > 0) {
      safeRemove(KEY_LIST_CHECKINS);
    }

    return { synced: true };
  } catch {
    return { synced: false };
  }
}
