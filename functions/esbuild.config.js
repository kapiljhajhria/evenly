// Bundles src/ + the @app/shared workspace into a single lib/index.cjs.
// This is what makes npm workspaces safe to deploy: the shared math is
// inlined, so the uploaded functions/ dir needs no workspace resolution.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'lib/index.cjs',
  sourcemap: true,
  logLevel: 'info',
  // Provided by the Cloud Functions runtime; installed from `dependencies`.
  external: ['firebase-admin', 'firebase-functions'],
});
