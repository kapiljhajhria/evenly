import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // *.web.test.ts drive the real web/ modules and need vitest.web.config.ts.
    exclude: ['tests/integration/**/*.web.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
