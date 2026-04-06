import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 seconds default timeout for Playwright tests
    hookTimeout: 30000,
    teardownTimeout: 10000,
    reporters: ['verbose'],
    env: {
      NODE_ENV: 'test'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'tests/**',
        'test-*.js',
        '*.config.js'
      ]
    }
  }
});
