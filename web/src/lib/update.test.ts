import { describe, expect, it } from 'vitest';
import { isStaleChunkError, lazy, StaleAppError } from './update.js';

describe('stale build detection', () => {
  it.each([
    'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.',
    'TypeError: Failed to fetch dynamically imported module: https://evenly.app/assets/jspdf-abc123.js',
    'TypeError: Importing a module script failed.',
    'TypeError: error loading dynamically imported module: https://evenly.app/assets/canvg-abc.js',
  ])('recognises %s', (message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it('leaves other errors alone', () => {
    expect(isStaleChunkError(new Error('Missing or insufficient permissions.'))).toBe(false);
    expect(isStaleChunkError(new Error('HTTP 404'))).toBe(false);
  });

  it('turns a stale import into StaleAppError and passes others through', async () => {
    await expect(lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: x')))).rejects.toBeInstanceOf(
      StaleAppError,
    );
    await expect(lazy(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(lazy(() => Promise.resolve(42))).resolves.toBe(42);
  });
});
