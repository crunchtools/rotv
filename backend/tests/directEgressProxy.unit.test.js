/**
 * The direct browser's guard proxy refuses to dial anything but public internet
 * addresses (directEgressProxy.js), for HTTPS tunnels and plain HTTP alike.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { directEgressProxyUrl } from '../services/directEgressProxy.js';

function getStatus(proxyUrl, target) {
  const { hostname, port } = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: hostname, port, method: 'GET', path: target }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
}

describe('directEgressProxy', () => {
  it('listens on loopback and reuses one server', async () => {
    const url = await directEgressProxyUrl();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await directEgressProxyUrl()).toBe(url);
  });

  it('refuses HTTPS tunnels to loopback, private and metadata addresses', async () => {
    const url = await directEgressProxyUrl();
    const { hostname, port } = new URL(url);
    for (const authority of ['127.0.0.1:8019', '[::1]:443', '10.89.1.10:25', '169.254.169.254:80', 'localhost:8082']) {
      const status = await new Promise((resolve, reject) => {
        const req = http.request({ host: hostname, port, method: 'CONNECT', path: authority });
        req.on('connect', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end();
      });
      expect(status, authority).toBe(403);
    }
  });

  it('refuses plain HTTP to non-public addresses and non-http schemes', async () => {
    const url = await directEgressProxyUrl();
    expect(await getStatus(url, 'http://127.0.0.1:8082/api/health')).toBe(403);
    expect(await getStatus(url, 'http://localhost:8082/')).toBe(403);
    expect(await getStatus(url, 'ftp://example.org/')).toBe(403);
  });
});
