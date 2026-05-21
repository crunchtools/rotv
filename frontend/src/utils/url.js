/**
 * Returns the URL only when it is a plain http(s) link, so externally-sourced
 * values (e.g. a scraped source_url) can't smuggle a javascript:/data: scheme
 * into an <a href>. Returns null otherwise; callers render plain text instead.
 */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? value : null;
  } catch {
    return null;
  }
}
