import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

// Real undici through a real (local) forward proxy: checks that http:// is
// forwarded as an absolute-URI request rather than CONNECT-tunnelled, which is
// what tinyproxy on lotor requires (it only CONNECTs to 443/563).
let origin;
let proxy;
const proxied = [];

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

beforeAll(async () => {
  origin = http.createServer((req, res) => res.end(`origin saw ${req.url}`));
  const originPort = await listen(origin);
  proxy = http.createServer((req, res) => {
    proxied.push({ method: req.method, url: req.url });
    const target = new URL(req.url);
    http.get({ host: '127.0.0.1', port: originPort, path: target.pathname }, up => up.pipe(res));
  });
  proxy.on('connect', (req, socket) => { proxied.push({ method: 'CONNECT', url: req.url }); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  const proxyPort = await listen(proxy);
  process.env.PLAYWRIGHT_PROXY = `http://127.0.0.1:${proxyPort}`;
  process.env.ORIGIN_PORT = String(originPort);
});

afterAll(() => {
  delete process.env.PLAYWRIGHT_PROXY;
  origin?.close();
  proxy?.close();
});

describe('proxyFetch through a real forward proxy', () => {
  it('forwards http:// requests to the proxy without CONNECT', async () => {
    const { proxyFetch } = await import('../utils/proxyFetch.js');
    const res = await proxyFetch(`http://trails.example.test:${process.env.ORIGIN_PORT}/status`);
    expect(await res.text()).toBe('origin saw /status');
    expect(proxied).toEqual([{ method: 'GET', url: `http://trails.example.test:${process.env.ORIGIN_PORT}/status` }]);
  });
});
