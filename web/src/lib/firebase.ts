import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Must match the region set in `functions/src/common.ts`. */
export const FUNCTIONS_REGION = 'asia-south1';

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  // Long-polling auto-detect keeps onSnapshot alive behind restrictive proxies
  // and inside in-app webviews.
  experimentalAutoDetectLongPolling: true,
});
export const functions = getFunctions(app, FUNCTIONS_REGION);
export const storage = getStorage(app);
// The SDK's default is to keep retrying one upload for 10 minutes. Receipt
// uploads have their own backoff and fall back to `failed` + Retry, so give
// up on each attempt sooner and let that loop decide.
storage.maxUploadRetryTime = 30_000;

export const usingEmulators =
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS !== 'false';

if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  console.info('[firebase] connected to the local Emulator Suite');
}
