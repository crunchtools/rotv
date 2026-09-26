const DEFAULT_TIMEZONE = 'America/New_York';
const IANA_REGION_CITY = /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/;

/**
 * Whitelist a client-supplied timezone to IANA Region/City form. Postgres
 * AT TIME ZONE accepts arbitrary input, so anything else falls back to the
 * park's timezone (PR #368 review).
 */
export function resolveTimezone(rawTz) {
  return typeof rawTz === 'string' && IANA_REGION_CITY.test(rawTz) ? rawTz : DEFAULT_TIMEZONE;
}

/** Parse a route param as a positive integer id; null when it is not one. */
export function parsePositiveId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
