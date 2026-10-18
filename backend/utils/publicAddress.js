import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';

/**
 * Public-internet-only connections for the 'direct' network route, which fetches
 * from lotor itself (egressRoutes.js). A crawled link that points at loopback, a
 * private network (the podman networks) or cloud metadata must never be fetched
 * that way (SSRF). The check runs where the connection is made — publicLookup
 * is the DNS lookup for those sockets — so the address that is checked is the
 * address that is dialed, and a DNS answer can't change in between.
 */

// Separate lists: a BlockList also applies ::ffff:0:0/96 rules to plain IPv4
// addresses, which would block all of IPv4.
const PRIVATE_V4 = new BlockList();
const PRIVATE_V6 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) PRIVATE_V4.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  // ::ffff:0:0/96 (IPv4-mapped, in any spelling) is refused outright rather than unpacked.
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]) PRIVATE_V6.addSubnet(net, prefix, 'ipv6');

/**
 * @param {string} address - An IPv4 or IPv6 literal
 * @returns {boolean}
 */
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !PRIVATE_V4.check(address, 'ipv4');
  if (family === 6) return !PRIVATE_V6.check(address, 'ipv6');
  return false;
}

function refuse(hostname) {
  const err = new Error(`refused a non-public address for ${hostname}`);
  err.code = 'ENOTPUBLIC';
  return err;
}

/**
 * A dns.lookup replacement for net/tls/http sockets: resolves like dns.lookup and
 * fails with ENOTPUBLIC if any address is not public.
 * @param {string} hostname
 * @param {object|Function} options
 * @param {Function} [callback]
 */
export function publicLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) return callback(refuse(hostname));
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * Whether a host is safe to dial directly: a public IP literal, or a name that
 * resolves only to public addresses. Sockets skip the lookup for IP literals, so
 * callers check those here before connecting.
 * @param {string} hostname
 * @returns {Promise<boolean>}
 */
export function isPublicHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return Promise.resolve(false);
  if (isIP(host)) return Promise.resolve(isPublicAddress(host));
  return new Promise(resolve => publicLookup(host, {}, err => resolve(!err)));
}

/**
 * isPublicHost for a URL: http(s) only.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export function isPublicUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(false);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return Promise.resolve(false);
  return isPublicHost(parsed.hostname);
}
