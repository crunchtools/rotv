// Signed/expiring CDN hosts (Facebook/Instagram) whose image URLs 404 after a few
// days. We skip them for share images and fall back to the stable POI photo.
export const EXPIRING_HOST = /(fbcdn\.net|cdninstagram\.com|lookaside\.[a-z0-9-]+\.(?:facebook|fbcdn)\.com)/i;

export function isUsableSourceImage(url) {
  return /^https?:\/\//i.test(url || '') && !EXPIRING_HOST.test(url);
}

// SSRF guard for backfill fetches: reject non-public hosts (localhost, internal
// TLDs, private/loopback/link-local IP literals). Does not resolve DNS.
export function isPublicHttpUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false;
  return true;
}
