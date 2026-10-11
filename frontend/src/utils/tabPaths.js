/**
 * Which URLs belong to a tab rather than a place (spec 048).
 */

// Top-level paths owned by a tab; anything else at that depth is a POI slug.
// backend/server.js OG_RESERVED_PATHS must list these too.
const MAIN_TAB_PATHS = ['find', 'happening', 'settings', 'about'];

// Curated lists with an address of their own, e.g. /fall-hiking-spree (spec 050).
// Any other list lives at /find/<list>. OG_RESERVED_PATHS must list these too.
const LIST_PATHS = ['fall-hiking-spree'];

/**
 * Where a curated list lives.
 * @param {string} slug The list's series
 * @returns {string}
 */
export function listPath(slug) {
  return LIST_PATHS.includes(slug) ? `/${slug}` : `/find/${slug}`;
}

// Links from before the tabs became Map / Find / Happening.
const LEGACY_TAB_PATHS = { results: '/find', news: '/happening', events: '/happening/events' };

/**
 * Read a tab out of a URL path.
 * @param {string[]} pathParts Path segments, no empty ones
 * @returns {{tab: string, view?: 'news'|'events', list?: string, redirectTo?: string}|null} null when the path
 *   belongs to a POI; `list` is the curated list a /find/<list> URL names (spec 050)
 */
export function parseTabPath(pathParts) {
  const redirectTo = pathParts.length === 1 ? LEGACY_TAB_PATHS[pathParts[0]] : undefined;
  const [first, second, ...rest] = redirectTo ? redirectTo.split('/').filter(Boolean) : pathParts;

  let found = null;
  if (first === 'happening' && rest.length === 0 && (second === undefined || second === 'events')) {
    found = { tab: 'happening', view: second === 'events' ? 'events' : 'news' };
  } else if (first === 'find' && second !== undefined && rest.length === 0) {
    found = { tab: 'find', list: second };
    if (LIST_PATHS.includes(second)) found.redirectTo = listPath(second);
  } else if (second === undefined && LIST_PATHS.includes(first)) {
    found = { tab: 'find', list: first };
  } else if (second === undefined && MAIN_TAB_PATHS.includes(first)) {
    found = { tab: first };
  }
  if (!found) return null;
  return redirectTo ? { ...found, redirectTo } : found;
}
