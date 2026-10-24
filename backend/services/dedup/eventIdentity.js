/**
 * Are two events the same event? One event is often listed by two organizers
 * (a park district and a friends group) or collected twice from one site (a
 * bare date with the noon fallback, then the real start time).
 */
import { canonicalUrl, normalizeTitle, contentTokens, foldCase, dayInTimezone } from './normalize.js';
import { charNgrams, dice } from './similarity.js';

const MINUTE_MS = 60 * 1000;

function isLocalNoon(date, tz) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(new Date(date));
  return time === '12:00:00';
}

/**
 * Precompute what the matcher compares.
 * @param {object} event event row: title, start_date, source_url, alt_urls, poi_id, venue_poi_id, location_details
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @returns {object} opaque features for matchEventFeatures
 */
export function eventFeatures(event, ctx) {
  const title = normalizeTitle(event.title);
  // Event titles are short; stopwords aside, every word matters, including place names
  const titleWords = title.split(' ').filter(Boolean);
  return {
    id: event.id,
    poiId: event.poi_id,
    venueId: event.venue_poi_id ?? null,
    urls: new Set([event.source_url, ...(event.alt_urls || [])].map(canonicalUrl).filter(Boolean)),
    title,
    titleGrams: charNgrams(titleWords),
    venueGrams: charNgrams(contentTokens(foldCase(event.location_details))),
    start: event.start_date ? Date.parse(event.start_date) : null,
    day: event.start_date ? dayInTimezone(event.start_date, ctx.tz) : null,
    // A bare date is stored at noon local time; its real start is unknown
    noonFallback: event.start_date ? isLocalNoon(event.start_date, ctx.tz) : false
  };
}

const matched = (reason, score) => ({ match: true, reason, score });

/**
 * Compare precomputed features.
 * @param {object} fa eventFeatures of one event
 * @param {object} fb eventFeatures of the other
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @returns {{match: boolean, reason: string|null, score: number}}
 */
export function matchEventFeatures(fa, fb, ctx) {
  const t = ctx.events;
  if (!fa.day || fa.day !== fb.day) return { match: false, reason: null, score: 0 };
  const sameTitle = Boolean(fa.title) && fa.title === fb.title;
  const title = sameTitle ? 1 : dice(fa.titleGrams, fb.titleGrams);
  // One URL can be a calendar page listing many events, so the URL alone is not
  // enough: the titles must still look alike
  if ([...fa.urls].some(url => fb.urls.has(url)) && title >= t.venueTitle) return matched('url', title);

  const sameVenue = fa.venueId != null && fa.venueId === fb.venueId;
  const sameOrganizer = fa.poiId != null && fa.poiId === fb.poiId;
  const nearStart = fa.start != null && fb.start != null &&
    Math.abs(fa.start - fb.start) <= t.venueMinutes * MINUTE_MS;
  // A 10 AM and a 1 PM "Paddleboard Tour" are two sessions. Times can only be
  // ignored for an identical title, or when one side never had a real time.
  const timesAgree = nearStart || sameTitle || fa.noonFallback || fb.noonFallback;
  if ((sameOrganizer || sameVenue) && timesAgree && title >= t.slotTitle) return matched('slot', title);

  const venueText = dice(fa.venueGrams, fb.venueGrams);
  if (nearStart && (sameVenue || venueText >= t.venueText) && title >= t.venueTitle) {
    return matched('venue', title);
  }
  return { match: false, reason: null, score: title };
}

/**
 * Are two event rows the same event?
 * @param {object} a event row
 * @param {object} b event row
 * @param {ReturnType<import('./context.js').createMatchContext>} ctx
 * @returns {{match: boolean, reason: string|null, score: number}}
 */
export function eventPairMatch(a, b, ctx) {
  return matchEventFeatures(eventFeatures(a, ctx), eventFeatures(b, ctx), ctx);
}
