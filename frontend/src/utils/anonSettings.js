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

export function readFavorites() {
  const raw = safeRead(KEY_FAVORITES);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(n => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function writeFavorites(poiIds) {
  safeWrite(KEY_FAVORITES, JSON.stringify(poiIds));
}

export function addFavorite(poiId) {
  const favorites = readFavorites();
  if (!favorites.includes(poiId)) {
    writeFavorites([...favorites, poiId]);
  }
}

export function removeFavorite(poiId) {
  writeFavorites(readFavorites().filter(id => id !== poiId));
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

  const hasState = timezone || (email && subscribed) || trips.length > 0 || favorites.length > 0;
  if (!hasState) return { synced: false };

  const payload = {};
  if (timezone) payload.timezone = timezone;
  if (email && subscribed) payload.newsletter = { email, subscribed };
  if (trips.length > 0) payload.trips = trips;
  if (favorites.length > 0) payload.favorites = favorites;

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

    return { synced: true };
  } catch {
    return { synced: false };
  }
}
