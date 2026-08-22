import { defineConfig } from 'vitest/config';

// Pure-logic tests only. Rules tests need the emulator and live in
// tests/rules with their own config (npm run test:rules).
export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts'],
    environment: 'node',
  },
});
