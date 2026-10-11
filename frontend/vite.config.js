import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server (./run.sh dev-ui) proxies everything the backend owns to the
// running dev container.
const apiTarget = process.env.ROTV_API_TARGET || 'http://localhost:8080';
const proxied = ['/api', '/auth', '/stats', '/share'];

// On dev.rootsofthevalley.org the dev server sits behind Cloudflare and the TLS
// proxy, so the page is served on 443 and the HMR socket must connect there too.
const devHost = process.env.ROTV_DEV_HOST;
const behindProxy = devHost
  ? { allowedHosts: [devHost], hmr: { path: '/__hmr', clientPort: 443 } }
  : {};

// Hosted dev sits behind Cloudflare, which caches .js by extension and then hands
// out stale modules beside current .jsx ones. Nothing from the dev server is cacheable.
const neverCached = {
  name: 'never-cached',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      delete req.headers['if-none-match'];
      delete req.headers['if-modified-since'];
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) => setHeader(name, /^cache-control$/i.test(name) ? 'no-store' : value);
      setHeader('Cache-Control', 'no-store');
      setHeader('CDN-Cache-Control', 'no-store');
      next();
    });
  }
};

export default defineConfig({
  plugins: [react(), neverCached],
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  server: {
    host: '0.0.0.0',
    port: 5173,
    ...behindProxy,
    proxy: Object.fromEntries(
      proxied.map((path) => [path, { target: apiTarget, changeOrigin: true }])
    )
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
