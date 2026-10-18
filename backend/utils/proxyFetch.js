import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { currentRoute } from '../services/egressRoutes.js';
import { isPublicUrl, publicLookup } from './publicAddress.js';

// One agent per proxy for the process: PLAYWRIGHT_PROXY and RESIDENTIAL_PROXY
// come from the service's environment file and don't change while the backend runs.
let agent = null;
let residentialAgent = null;
let directAgent = null;

/**
 * fetch() that egresses like the Playwright scrapers, for plain HTTP requests
 * to sites ROTV scrapes: through the scraper proxy (PLAYWRIGHT_PROXY, the
 * ExpressVPN tinyproxy) unless the host's network route is direct or IPRoyal
 * (see egressRoutes.js; no failover here). Official APIs (USGS, Bluesky,
 * OpenRouter, ...) keep using the global fetch directly.
 * Without PLAYWRIGHT_PROXY (dev/CI) it is the global fetch, except for a
 * residential route when RESIDENTIAL_PROXY is set.
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function proxyFetch(url, init = {}) {
  const route = currentRoute(String(url));
  if (route === 'residential') {
    residentialAgent ??= new ProxyAgent({ uri: process.env.RESIDENTIAL_PROXY });
    return undiciFetch(url, { ...init, dispatcher: residentialAgent });
  }
  const proxy = process.env.PLAYWRIGHT_PROXY;
  // Direct leaves from lotor itself: public addresses only (SSRF). The guarded agent
  // checks every connection it makes, redirects included; a non-public IP literal
  // (which skips DNS) keeps going through the scraper proxy.
  if (route === 'direct' && proxy && await isPublicUrl(String(url))) return fetchDirect(String(url), init);
  if (!proxy) return fetch(url, init);
  // Fix: create once instead of swapping agents (and leaking the old one's pool) on a proxy change (PR #676 review)
  // proxyTunnel:false sends http:// as a plain forward-proxy request: tinyproxy
  // only allows CONNECT to 443/563, so tunnelling port 80 gets a 403.
  // https:// is still tunnelled with CONNECT.
  agent ??= new ProxyAgent({ uri: proxy, proxyTunnel: false });
  return undiciFetch(url, { ...init, dispatcher: agent });
}

const MAX_DIRECT_REDIRECTS = 5;

/**
 * The direct route's fetch: connections go through publicLookup, and redirects
 * are followed here so every hop, IP literals included (they skip DNS), is
 * checked before it is dialed.
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
async function fetchDirect(url, init) {
  directAgent ??= new Agent({ connect: { lookup: publicLookup } });
  let current = url;
  for (let hop = 0; hop <= MAX_DIRECT_REDIRECTS; hop++) {
    if (hop > 0 && !(await isPublicUrl(current))) throw new Error(`direct route refused a non-public address: ${current}`);
    const response = await undiciFetch(current, { ...init, redirect: 'manual', dispatcher: directAgent });
    const location = response.headers.get('location');
    if (init.redirect === 'manual' || response.status < 300 || response.status >= 400 || !location) {
      if (current !== url) Object.defineProperty(response, 'url', { value: current });
      return response;
    }
    current = new URL(location, current).href;
  }
  throw new Error(`direct route: more than ${MAX_DIRECT_REDIRECTS} redirects from ${url}`);
}
