// Bundles src/ + the shared math into a single lib/index.cjs.
//
// @app/shared is resolved by an explicit alias rather than being listed as a
// dependency of this package. functions/package.json is uploaded verbatim and
// `npm install` runs against the public registry up there — a workspace-only
// name like "@app/shared": "*" is unresolvable, so it must never appear in it.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const shared = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'lib/index.cjs',
  sourcemap: true,
  logLevel: 'info',
  alias: { '@app/shared': shared },
  // Provided by the Cloud Functions runtime; installed from `dependencies`.
  external: ['firebase-admin', 'firebase-functions'],
});
