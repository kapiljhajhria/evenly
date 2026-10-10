import { defineConfig, loadEnv, type Plugin } from 'vite';
import type { OutputChunk } from 'rollup';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const REQUIRED_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

/**
 * Without this a missing config compiles to `undefined` and builds perfectly
 * happily — you only find out from `auth/invalid-api-key` in the browser after
 * deploying. Fail here instead, while the fix is still cheap.
 */
function assertProductionEnv(mode: string, envDir: string): void {
  const env = loadEnv(mode, envDir, 'VITE_');

  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `\n\nMissing Firebase config: ${missing.join(', ')}\n\n` +
        `Create web/.env.production.local with the values from\n` +
        `Firebase console -> Project settings -> Your apps -> Web app.\n` +
        `See DEPLOY.md section 6. Use .env.production.local, not .env.local —\n` +
        `.env.local is also read by \`npm run dev\` and would point local\n` +
        `development at live data.\n`,
    );
  }

  // Optional — the app works without it — but a build that silently lacks it
  // ships "Notifications are not set up" to every device. Say so loudly.
  if (!env['VITE_FIREBASE_VAPID_KEY']) {
    console.warn(
      `\n\x1b[33m⚠  VITE_FIREBASE_VAPID_KEY is not set — this build will have push notifications\n` +
        `   turned off ("not set up for this build of the app"). Add it to\n` +
        `   web/.env.production.local — see DEPLOY.md, "Push notifications (one-time)".\x1b[0m\n`,
    );
  }

  const demoProject = env['VITE_FIREBASE_PROJECT_ID']?.startsWith('demo-') ?? false;
  const emulatorBuild = env['VITE_USE_EMULATORS'] === 'true';
  // A build wired to the emulators must be a demo project — never let a real
  // deploy point every user at localhost.
  if (emulatorBuild && !demoProject) {
    throw new Error(
      `\n\nVITE_USE_EMULATORS=true is only for local test builds against a demo- project.\n` +
        `Remove it from the environment before building for real.\n`,
    );
  }
  // ...and a demo project is only buildable as such a test build
  // (`npm run build:e2e`), never by accident.
  if (demoProject && !emulatorBuild) {
    throw new Error(
      `\n\nRefusing to build against the emulator project ` +
        `"${env['VITE_FIREBASE_PROJECT_ID']}".\n` +
        `Those values only work against a local Emulator Suite.\n` +
        `Put your real project config in web/.env.production.local.\n`,
    );
  }
}

/** Chunks kept out of the precache because they load only when exporting. */
const LAZY_ONLY = /^assets\/(jspdf|html2canvas|purify|canvg|pdf-lib)/;

/**
 * Fail the build if the app's startup code statically imports one of the
 * lazy-only chunks. Such a chunk is not precached, so a static import means a
 * blank page offline (and a big download on every start). This happened once,
 * silently, via a manual chunk; it should never ship again.
 */
function lazyChunksStayLazy(): Plugin {
  return {
    name: 'evenly:lazy-chunks-stay-lazy',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle)
          .filter((item): item is OutputChunk => item.type === 'chunk')
          .map((chunk) => [chunk.fileName, chunk]),
      );
      for (const entry of [...chunks.values()].filter((chunk) => chunk.isEntry)) {
        const seen = new Set<string>();
        const visit = (fileName: string, path: string[]) => {
          if (seen.has(fileName)) return;
          seen.add(fileName);
          if (LAZY_ONLY.test(fileName)) {
            this.error(
              `${[...path, fileName].join(' → ')}: the app's startup imports a lazy-only chunk. ` +
                `It is not precached, so the app would show a blank page offline.`,
            );
          }
          for (const next of chunks.get(fileName)?.imports ?? []) visit(next, [...path, fileName]);
        };
        visit(entry.fileName, []);
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const envDir = process.cwd();
  if (command === 'build') assertProductionEnv(mode, envDir);

  return {
    plugins: [
      lazyChunksStayLazy(),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Evenly',
          short_name: 'Evenly',
          description: 'Split expenses with your friends. Settle up over UPI.',
          theme_color: '#0f172a',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            // Separate file: a maskable icon gets cropped to a circle, so the
            // mark needs its own padding rather than reusing the square one.
            { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        // Our own service worker (src/sw.ts) rather than a generated one, so it
        // can receive push notifications. It reproduces the generated
        // behaviour: precache, index.html fallback outside /__/, and wait for
        // SKIP_WAITING from the update ticker.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // PDF export and the libraries jsPDF pulls in (~750KB), plus pdf-lib
          // for merging PDF bills, load only when someone exports. Precaching
          // them would make every user download them on every update.
          globIgnores: ['**/jspdf*', '**/html2canvas*', '**/purify*', '**/canvg*', '**/pdf-lib*'],
        },
        // Off in normal development. `PWA_DEV=1 npm run dev` turns it on, to
        // try push and offline behaviour against the emulators.
        devOptions: { enabled: process.env['PWA_DEV'] === '1', type: 'module', navigateFallback: 'index.html' },
      }),
    ],
    server: { port: 5173, host: true },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: [
              'firebase/app',
              'firebase/auth',
              'firebase/firestore',
              'firebase/functions',
              'firebase/storage',
            ],
            // NOT canvg or pdf-lib. A manual chunk drags shared helpers in
            // with it (Rollup's commonjs helper landed in whichever one came
            // first), which made the app's entry statically import a big
            // lazy-only chunk — downloaded on every start, and, being kept out
            // of the precache, a blank page offline. lazyChunksStayLazy()
            // fails the build if that ever happens again.
          },
          // Name the lazy export chunks so the precache can exclude them,
          // without changing what goes into them.
          chunkFileNames: (chunk) =>
            chunk.facadeModuleId?.includes('/node_modules/pdf-lib/')
              ? 'assets/pdf-lib-[hash].js'
              : chunk.facadeModuleId?.includes('/node_modules/canvg/')
                ? 'assets/canvg-[hash].js'
                : 'assets/[name]-[hash].js',
        },
      },
      chunkSizeWarningLimit: 900,
    },
  };
});
