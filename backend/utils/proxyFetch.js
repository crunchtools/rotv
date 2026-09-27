import { ProxyAgent, fetch as undiciFetch } from 'undici';

let agent = null;
let agentProxy = null;

/**
 * fetch() that egresses through the scraper proxy (PLAYWRIGHT_PROXY, the
 * ExpressVPN tinyproxy), for plain HTTP requests to sites ROTV scrapes, so
 * they leave from the same exit as the Playwright scrapers. Official APIs
 * (USGS, Bluesky, OpenRouter, ...) keep using the global fetch directly.
 * Without PLAYWRIGHT_PROXY (dev/CI) it is the global fetch.
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function proxyFetch(url, init = {}) {
  const proxy = process.env.PLAYWRIGHT_PROXY;
  if (!proxy) return fetch(url, init);
  if (agentProxy !== proxy) {
    // proxyTunnel:false sends http:// as a plain forward-proxy request: tinyproxy
    // only allows CONNECT to 443/563, so tunnelling port 80 gets a 403.
    // https:// is still tunnelled with CONNECT.
    agent = new ProxyAgent({ uri: proxy, proxyTunnel: false });
    agentProxy = proxy;
  }
  return undiciFetch(url, { ...init, dispatcher: agent });
}
