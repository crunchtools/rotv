import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Frontend unit tests (hooks, pure utils). Kept separate from vite.config.js so
// the dev-server proxy and build settings stay out of the test run.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
    unstubGlobals: true
  }
});
