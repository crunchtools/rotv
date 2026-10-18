import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { routeFor, effectiveRoute } from '../services/egressRoutes.js';

// One agent per proxy for the process: PLAYWRIGHT_PROXY and RESIDENTIAL_PROXY
// come from the service's environment file and don't change while the backend runs.
let agent = null;
let residentialAgent = null;

/**
 * fetch() that egresses like the Playwright scrapers, for plain HTTP requests
 * to sites ROTV scrapes: through the scraper proxy (PLAYWRIGHT_PROXY, the
 * ExpressVPN tinyproxy) unless egress_routes sends the host direct or through
 * the residential proxy (see egressRoutes.js). Official APIs (USGS, Bluesky,
 * OpenRouter, ...) keep using the global fetch directly.
 * Without PLAYWRIGHT_PROXY (dev/CI) it is the global fetch, except for a
 * residential route when RESIDENTIAL_PROXY is set.
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function proxyFetch(url, init = {}) {
  const route = effectiveRoute(routeFor(String(url)));
  if (route === 'residential') {
    residentialAgent ??= new ProxyAgent({ uri: process.env.RESIDENTIAL_PROXY });
    return undiciFetch(url, { ...init, dispatcher: residentialAgent });
  }
  const proxy = process.env.PLAYWRIGHT_PROXY;
  if (!proxy || route === 'direct') return fetch(url, init);
  // Fix: create once instead of swapping agents (and leaking the old one's pool) on a proxy change (PR #676 review)
  // proxyTunnel:false sends http:// as a plain forward-proxy request: tinyproxy
  // only allows CONNECT to 443/563, so tunnelling port 80 gets a 403.
  // https:// is still tunnelled with CONNECT.
  agent ??= new ProxyAgent({ uri: proxy, proxyTunnel: false });
  return undiciFetch(url, { ...init, dispatcher: agent });
}
