import { defineConfig, loadEnv } from 'vite';
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

  if (env['VITE_FIREBASE_PROJECT_ID']?.startsWith('demo-')) {
    throw new Error(
      `\n\nRefusing to build against the emulator project ` +
        `"${env['VITE_FIREBASE_PROJECT_ID']}".\n` +
        `Those values only work against a local Emulator Suite.\n` +
        `Put your real project config in web/.env.production.local.\n`,
    );
  }
}

export default defineConfig(({ command, mode }) => {
  const envDir = process.cwd();
  if (command === 'build') assertProductionEnv(mode, envDir);

  return {
    plugins: [
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
            // Named so the precache can exclude them; both load lazily.
            canvg: ['canvg'],
            'pdf-lib': ['pdf-lib'],
          },
        },
      },
      chunkSizeWarningLimit: 900,
    },
  };
});
