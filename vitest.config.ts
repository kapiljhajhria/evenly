import { defineConfig } from 'vitest/config';

// Pure-logic tests only — no emulator, no DOM. Rules tests live in
// tests/rules and integration tests in tests/integration, each with their
// own config.
export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
  },
});
