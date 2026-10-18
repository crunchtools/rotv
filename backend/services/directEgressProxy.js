import http from 'node:http';
import net from 'node:net';
import { publicLookup, isPublicAddress } from '../utils/publicAddress.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DirectEgress');

/**
 * The 'direct' browser's proxy: a forward proxy on 127.0.0.1 inside the backend
 * that dials only public internet addresses (publicAddress.js). Chromium sends
 * every request through it — subresources and redirect hops included — so a page
 * can't make lotor fetch loopback, the podman networks or cloud metadata. HTTPS
 * stays end-to-end encrypted (CONNECT tunnel); nothing is inspected.
 */

let started = null;

function splitHostPort(authority, defaultPort) {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(authority) || /^([^:]+)(?::(\d+))?$/.exec(authority);
  if (!m) return null;
  return { host: m[1], port: Number(m[2]) || defaultPort };
}

// Sockets skip the lookup for IP literals, so refuse non-public ones here.
function dialable(host) {
  return net.isIP(host) ? isPublicAddress(host) : true;
}

function onConnect(req, clientSocket, head) {
  const target = splitHostPort(req.url, 443);
  if (!target || !dialable(target.host)) {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const upstream = net.connect({ host: target.host, port: target.port, lookup: publicLookup }, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', (err) => {
    if (err.code === 'ENOTPUBLIC') logger.warn(`Refused ${req.url}: ${err.message}`);
    clientSocket.end(`HTTP/1.1 ${err.code === 'ENOTPUBLIC' ? '403 Forbidden' : '502 Bad Gateway'}\r\n\r\n`);
  });
  clientSocket.on('error', () => upstream.destroy());
}

function onRequest(req, res) {
  let target;
  try {
    target = new URL(req.url);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (target.protocol !== 'http:' || !dialable(host)) {
    res.writeHead(403).end();
    return;
  }
  const headers = { ...req.headers };
  delete headers['proxy-connection'];
  delete headers['proxy-authorization'];
  const upstream = http.request({
    host, port: Number(target.port) || 80, path: `${target.pathname}${target.search}`,
    method: req.method, headers, lookup: publicLookup
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', (err) => {
    if (err.code === 'ENOTPUBLIC') logger.warn(`Refused ${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(err.code === 'ENOTPUBLIC' ? 403 : 502);
    res.end();
  });
  req.pipe(upstream);
}

/**
 * Start the proxy once (lazily) and return its URL for Chromium's proxy option.
 * @returns {Promise<string>} e.g. http://127.0.0.1:41234
 */
export function directEgressProxyUrl() {
  started ??= new Promise((resolve, reject) => {
    const server = http.createServer(onRequest);
    server.on('connect', onConnect);
    server.on('error', (err) => {
      started = null;
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
  return started;
}
