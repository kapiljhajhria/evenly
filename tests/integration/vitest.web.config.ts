import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Runs the real web/ modules against the emulators. Vitest forces mode=test,
 * so web/.env.development is loaded by hand rather than by Vite's own env
 * resolution — the values still reach `import.meta.env` untouched.
 */
const env = Object.fromEntries(
  readFileSync('web/.env.development', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq), line.slice(eq + 1)];
    }),
);

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.web.test.ts'],
    environment: 'node',
    setupFiles: ['tests/integration/setup.web.ts'],
    env,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
