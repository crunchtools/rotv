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

function safeRead(key) {
  try {
    return localStorage.getItem(key);
  } catch {
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

export function readEmail() {
  return safeRead(KEY_NEWSLETTER_EMAIL) || '';
}

export function writeEmail(value) {
  safeWrite(KEY_NEWSLETTER_EMAIL, value);
}

export function writeSubscribed(value) {
  safeWrite(KEY_NEWSLETTER_SUBSCRIBED, value ? 'true' : 'false');
}

export function readTrips() {
  const raw = safeRead(KEY_SAVED_TRIPS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeTrips(trips) {
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
  const read = () => {
    const raw = safeRead(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(n => Number.isInteger(n)) : [];
    } catch {
      return [];
    }
  };
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
export const writeFavorites = favoritesStore.write;
export const addFavorite = favoritesStore.add;
export const removeFavorite = favoritesStore.remove;

const visitedStore = createPoiIdListStore(KEY_VISITED);
export const readVisited = visitedStore.read;
export const writeVisited = visitedStore.write;
export const addVisited = visitedStore.add;
export const removeVisited = visitedStore.remove;

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

  const hasState = timezone || (email && subscribed) || trips.length > 0
    || favorites.length > 0 || visited.length > 0;
  if (!hasState) return { synced: false };

  const payload = {};
  if (timezone) payload.timezone = timezone;
  if (email && subscribed) payload.newsletter = { email, subscribed };
  if (trips.length > 0) payload.trips = trips;
  if (favorites.length > 0) payload.favorites = favorites;
  if (visited.length > 0) payload.visited = visited;

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

    return { synced: true };
  } catch {
    return { synced: false };
  }
}
