/**
 * Usage analytics (#637). Umami is served first-party at /stats; the backend
 * tells us the website id, or null when analytics is off (tests, local builds
 * without Umami). track() never throws and does nothing until the tracker has
 * loaded; events fired before then are queued, and dropped if it never loads
 * (blocked, offline).
 */

const MAX_QUEUE = 50;
let queue = [];
let started = false;

function flush() {
  if (!window.umami) return;
  const pending = queue;
  queue = [];
  pending.forEach(([name, props]) => window.umami.track(name, props));
}

/**
 * Load the Umami tracker once, if the backend reports a website id. Resolves
 * without enabling anything when analytics is off or unreachable.
 */
export async function initAnalytics() {
  if (started) return;
  started = true;
  try {
    const res = await fetch('/api/analytics/config');
    if (!res.ok) return;
    const { websiteId } = await res.json();
    if (!websiteId) { queue = []; return; }
    const script = document.createElement('script');
    script.defer = true;
    script.src = '/stats/script.js';
    script.dataset.websiteId = websiteId;
    script.onload = flush;
    script.onerror = () => { queue = []; };
    document.head.appendChild(script);
  } catch (err) {
    console.warn('Analytics disabled:', err.message);
    queue = [];
  }
}

/**
 * Record a custom event. Never throws; queued until the tracker loads.
 * @param {string} name event name, e.g. 'tracker_click'
 * @param {object} [props] event properties (strings/numbers/booleans)
 */
export function track(name, props) {
  try {
    if (window.umami) {
      window.umami.track(name, props);
    } else if (queue.length < MAX_QUEUE) {
      queue.push([name, props]);
    }
  } catch {
    // Analytics must never break the app
  }
}

/** Umami's own opt-out flag: the tracker sends nothing from this browser. */
export function excludeThisDevice() {
  try {
    localStorage.setItem('umami.disabled', '1');
  } catch {
    // Private mode or blocked storage: nothing to persist
  }
}

/** 'train' | 'water_taxi' | null for a POI that has a live tracker route. */
export function trackerVehicle(poi) {
  if (poi?.poi_roles?.includes('railroad')) return 'train';
  if (poi?.poi_roles?.includes('water_taxi')) return 'water_taxi';
  return null;
}
