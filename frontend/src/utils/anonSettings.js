// LocalStorage-backed customizations for anonymous (not-logged-in) visitors.
// On first successful sign-in, syncAnonSettings() POSTs accumulated state to
// /api/user/settings/sync (server-wins fill-gaps) and clears synced keys.
// See .specify/specs/018-anon-user-settings/ for the architecture.

const KEY_TIMEZONE = 'app-timezone';
const KEY_NEWSLETTER_EMAIL = 'rotv-newsletter-email';
const KEY_NEWSLETTER_SUBSCRIBED = 'rotv-newsletter-subscribed';
const KEY_SAVED_TRIPS = 'rotv-saved-trips';

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
    // localStorage may be unavailable (private mode, quota); ignore
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function readTimezone() {
  return safeRead(KEY_TIMEZONE);
}

export function readEmail() {
  return safeRead(KEY_NEWSLETTER_EMAIL) || '';
}

export function writeEmail(value) {
  safeWrite(KEY_NEWSLETTER_EMAIL, value);
}

export function readSubscribed() {
  return safeRead(KEY_NEWSLETTER_SUBSCRIBED) === 'true';
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
  const trips = readTrips();
  // Dedup by slug — overwrites a same-slug local trip (last-write-wins locally)
  const filtered = trips.filter(t => t.slug !== trip.slug);
  filtered.push({ ...trip, savedAt: new Date().toISOString() });
  writeTrips(filtered);
}

export function removeTrip(slug) {
  writeTrips(readTrips().filter(t => t.slug !== slug));
}

// Flushes all accumulated anonymous state to the backend on first successful
// sign-in. Server-wins semantics: backend only fills NULL timezone, only
// inserts newsletter subscriptions/trips that don't already exist for the
// user. Safe to call repeatedly — no-op when no anon state is present.
export async function syncAnonSettings() {
  const timezone = readTimezone();
  const email = readEmail();
  const subscribed = readSubscribed();
  const trips = readTrips();

  const hasState =
    timezone ||
    (email && subscribed) ||
    trips.length > 0;

  if (!hasState) return { synced: false };

  const payload = {};
  if (timezone) payload.timezone = timezone;
  if (email && subscribed) payload.newsletter = { email, subscribed };
  if (trips.length > 0) payload.trips = trips;

  try {
    const res = await fetch('/api/user/settings/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!res.ok) return { synced: false, status: res.status };

    // Clear synced keys. Timezone is intentionally retained because the
    // logged-in client still reads it from the same key for now (server
    // column is canonical, but client doesn't refetch yet).
    if (email && subscribed) {
      safeRemove(KEY_NEWSLETTER_EMAIL);
      safeRemove(KEY_NEWSLETTER_SUBSCRIBED);
    }
    if (trips.length > 0) {
      safeRemove(KEY_SAVED_TRIPS);
    }

    return { synced: true };
  } catch {
    return { synced: false };
  }
}
