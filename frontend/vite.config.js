import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server (./run.sh dev-ui) proxies everything the backend owns to the
// running dev container.
const apiTarget = process.env.ROTV_API_TARGET || 'http://localhost:8080';
const proxied = ['/api', '/auth', '/stats', '/share'];

// On dev.rootsofthevalley.org the dev server sits behind the TLS proxy, which
// asks for basic auth on everything but the HMR socket: its own path, because
// mobile Safari sends no credentials on a WebSocket.
const devHost = process.env.ROTV_DEV_HOST;
const behindProxy = devHost
  ? { allowedHosts: [devHost], hmr: { path: '/__hmr', clientPort: 443 } }
  : {};

export default defineConfig({
  plugins: [react()],
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
