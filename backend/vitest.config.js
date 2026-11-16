import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 120000,
    setupFiles: ['./tests/setup.js'],
    // Integration tests share one database; run files sequentially for determinism.
    fileParallelism: false,
  },
});
