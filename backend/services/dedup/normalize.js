/**
 * Normalization shared by every duplicate check (collection, moderation, digest).
 *
 * URL identity in the database is LOWER(REGEXP_REPLACE(url, '/+$', '')): the
 * unique index (migration 069), the save-time lookup and the digest's event-page
 * exclusion all use it. canonicalUrl is applied in memory only and is a superset
 * of that rule: two URLs equal under the SQL rule are always equal here, so the
 * database and the matcher never disagree in the direction that inserts a dup.
 */

// WordPress and JSON-LD text carries HTML entities ("Let&#8217;s", "Kayak &amp; Canoe")
const NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
// Out-of-range numeric entities are left as-is instead of throwing
const fromCode = (entity, code) => (code <= 0x10FFFF ? String.fromCodePoint(code) : entity);

/**
 * Decode numeric and common named HTML entities.
 * @param {string|null|undefined} text
 * @returns {string} decoded text; '' when text is missing
 */
export function decodeEntities(text) {
  return (text || '')
    .replace(/&#(\d+);/g, (entity, code) => fromCode(entity, Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (entity, code) => fromCode(entity, parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);
}

/**
 * Lowercase and strip diacritics, so "Día" and "Dia" compare equal.
 * @param {string} text
 * @returns {string}
 */
export function foldCase(text) {
  return (text || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

const TRACKING_PARAM = /^(?:utm_.*|fbclid|gclid|dclid|mc_cid|mc_eid|ocid|cmpid|_ga)$/i;

/**
 * Canonical form of a URL for identity checks: no scheme, no www./m./amp. host
 * prefix, no /amp path segment, no trailing slash or index.html, no fragment,
 * no tracking parameters, remaining parameters sorted. Unparseable input falls
 * back to the SQL rule (lowercase, trailing slashes trimmed).
 * @param {string|null|undefined} url
 * @returns {string|null} canonical key, or null when url is empty
 */
export function canonicalUrl(url) {
  const raw = (url || '').trim();
  if (!raw) return null;
  if (!URL.canParse(raw)) return raw.toLowerCase().replace(/\/+$/, '');
  const parsed = new URL(raw);
  const host = parsed.hostname.toLowerCase().replace(/^(?:www|m|amp)\./, '');
  const path = parsed.pathname
    .replace(/\/amp(?=\/|$)/gi, '')
    .replace(/\/index\.html?$/i, '')
    .replace(/\/+$/, '');
  const params = [...parsed.searchParams]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  return `${host}${path}${query}`.toLowerCase();
}

/**
 * Hostname without a leading www., for outlet comparisons and display.
 * @param {string|null|undefined} url
 * @returns {string|null} host, or null when url is missing or unparseable
 */
export function urlHost(url) {
  if (!url || !URL.canParse(url)) return null;
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * The title key the database compares on: lowercase, leading "The " dropped.
 * Mirrors SQL_NORMALIZE_TITLE in newsService.js; change both or neither.
 * @param {string|null|undefined} title
 * @returns {string}
 */
export function titleKey(title) {
  if (!title) return '';
  return title.toLowerCase().replace(/^the\s+/i, '').trim();
}

// "| YYYY-MM-DD", "| Month D, YYYY": collection appends the listing date to some titles
const TITLE_DATE_SUFFIX = /\s*\|\s*(?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)\s*$/i;
// A tail after " | " or " - " is a site name when it is short and digit-free
// ("Fall Hike | Summit Metro Parks"), or when it spells the outlet's host
// ("Lake sturgeon release - Fox 8 Cleveland WJW" on fox8.com)
const TITLE_TAIL = /\s+[|–—-]\s+([^|–—]+)$/;
const MAX_SITE_SUFFIX_WORDS = 4;

/**
 * The site name a title ends with, if any.
 * @param {string|null|undefined} title
 * @param {string|null} [host] the outlet's host, e.g. "fox8.com"
 * @returns {string|null} the tail without its separator, or null
 */
export function titleSiteSuffix(title, host = null) {
  const tail = decodeEntities(title).replace(TITLE_DATE_SUFFIX, '').trim().match(TITLE_TAIL);
  if (!tail) return null;
  const words = tail[1].trim().split(/\s+/);
  if (words.length <= MAX_SITE_SUFFIX_WORDS && !/\d/.test(tail[1])) return tail[1].trim();
  const label = host ? foldCase(host.split('.').slice(-2, -1)[0] || '') : '';
  const compact = foldCase(tail[1]).replace(/[^\p{L}\p{N}]+/gu, '');
  return label.length >= 3 && words.length <= MAX_SITE_SUFFIX_WORDS + 2 && compact.includes(label) ? tail[1].trim() : null;
}

/**
 * Title for matching: entities decoded, date and site-name suffixes dropped,
 * case and diacritics folded, leading "the" dropped, punctuation collapsed.
 * @param {string|null|undefined} title
 * @param {string|null} [host] the outlet's host, to recognize a site name that contains digits
 * @returns {string}
 */
export function normalizeTitle(title, host = null) {
  let text = decodeEntities(title).replace(TITLE_DATE_SUFFIX, '').trim();
  const suffix = titleSiteSuffix(text, host);
  if (suffix) text = text.slice(0, text.lastIndexOf(suffix)).replace(/\s+[|–—-]\s*$/, '');
  return foldCase(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the\s+/, '');
}

// A scraped summary can end in the page's dateline ("Published: <date> at
// 9:26 AM PDT|Updated: 16 hours ago"). Its words say when, not what. Each
// phrase ends at "ago", a time with its zone, a "|" separator, or the end.
const DATELINE_RE = /\b(?:published|updated|posted)\s*:[^|]*?(?:\bago\b|\b[ap]\.?m\.?\s+[a-z]{2,4}\b|(?=\|)|$)/gi;

/**
 * Remove "Published:/Updated:/Posted:" dateline phrases. Other dates and
 * numbers are left alone.
 * @param {string|null|undefined} text
 * @returns {string} the text with dateline phrases replaced by a space; '' when missing
 */
export function stripDateline(text) {
  return (text || '').replace(DATELINE_RE, ' ');
}

const BOILERPLATE_RES = [
  /\bBy\s+[A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3}\s*(?=\||,|$)/g,
  /\b\d+\s*(?:min|minute)s?\s+read\b/gi,
  /\bshare\s+(?:this\s+(?:article|story)|(?:on|via)\s+(?:facebook|twitter|x|email|linkedin|pinterest|reddit))\b/gi,
  /\b(?:click|tap)\s+here\s+to\s+(?:read|subscribe|sign up)[^.|]*/gi
];
const MAX_TAIL_SEGMENT_WORDS = 4;

/**
 * Remove page chrome that says nothing about the story: datelines, bylines,
 * "N min read", share prompts, and short pipe-separated tails
 * ("… | Akron Beacon Journal | Local News").
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function stripBoilerplate(text) {
  let cleaned = stripDateline(decodeEntities(text));
  for (const re of BOILERPLATE_RES) cleaned = cleaned.replace(re, ' ');
  const segments = cleaned.split('|');
  while (segments.length > 1) {
    const tail = segments[segments.length - 1].trim();
    if (tail && tail.split(/\s+/).length > MAX_TAIL_SEGMENT_WORDS) break;
    segments.pop();
  }
  return segments.join('|').replace(/\s+/g, ' ').trim();
}

export const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'will', 'with', 'its', 'has', 'have', 'had',
  'this', 'that', 'these', 'those', 'from', 'they', 'their', 'been', 'was',
  'were', 'which', 'also', 'more', 'than', 'into', 'about', 'after', 'before',
  'host', 'hosts', 'hosting', 'held', 'hold', 'holds', 'new', 'news',
  'announce', 'announces', 'announced', 'including', 'include', 'includes',
  'not', 'but', 'can', 'all', 'our', 'you', 'your', 'out', 'who', 'what',
  'when', 'where', 'how', 'over', 'each', 'other', 'some', 'such', 'then',
  'there', 'here', 'while', 'during', 'through', 'his', 'her', 'she', 'him'
]);

/**
 * Lowercase content words: diacritics folded, at least 3 characters, no
 * stopwords, nothing in `drop`. No stemming: similarity works on character
 * n-grams, which already treat "derby" and "derbies" as close.
 * @param {string|null|undefined} text
 * @param {{drop?: Set<string>}} [options]
 * @returns {string[]} tokens in text order, duplicates kept
 */
export function contentTokens(text, { drop } = {}) {
  return foldCase(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !(drop && drop.has(w)));
}

/**
 * Words of a place name, as a drop set for contentTokens.
 * @param {...(string|null|undefined)} names
 * @returns {Set<string>}
 */
export function nameWords(...names) {
  const words = new Set();
  for (const name of names) {
    for (const w of foldCase(name).split(/[^\p{L}\p{N}]+/u)) if (w) words.add(w);
  }
  return words;
}

/**
 * Calendar day of an instant in a timezone, as YYYY-MM-DD.
 * @param {string|Date} date
 * @param {string} tz IANA timezone
 * @returns {string}
 */
export function dayInTimezone(date, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(date));
}
