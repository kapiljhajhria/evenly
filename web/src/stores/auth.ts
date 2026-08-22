import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { create } from 'zustand';
import { auth } from '../lib/firebase.js';
import { userDoc } from '../lib/paths.js';
import { isInAppWebview } from '../lib/webview.js';
import { readLocal, writeLocal } from '../lib/storage.js';

/** Mirrors the length cap in firestore.rules — keep the two in step. */
export const MAX_DISPLAY_NAME = 40;

interface AuthState {
  user: User | null;
  /**
   * Held separately from `user` because updateProfile mutates the User object
   * in place — React would never see the change through a stable reference.
   */
  displayName: string | null;
  photoURL: string | null;
  /** True until the first onAuthStateChanged fires — do not redirect before then. */
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  clearError: () => void;
}

/**
 * Keep users/{uid} in step with the auth profile, WITHOUT ever overwriting a
 * name the user chose for themselves: displayName is only written when the doc
 * is first created. After that it belongs to the user, and signing in again
 * with Google must not put the Google name back.
 *
 * Runs at most once per profile change per device — it is a write, not a read.
 */
async function mirrorUserDoc(user: User): Promise<void> {
  const stamp = `user-mirrored:${user.uid}`;
  const fingerprint = `${user.photoURL ?? ''}|${user.displayName ?? ''}`;
  if (readLocal(stamp) === fingerprint) return;

  const existing = await getDoc(userDoc(user.uid));
  if (!existing.exists()) {
    await setDoc(userDoc(user.uid), {
      displayName: user.displayName?.slice(0, MAX_DISPLAY_NAME) || (user.email ?? 'Member'),
      photoURL: user.photoURL,
      createdAt: serverTimestamp(),
    });
  } else if (existing.data()['photoURL'] !== user.photoURL) {
    // The avatar can legitimately change upstream; the name cannot.
    await updateDoc(userDoc(user.uid), { photoURL: user.photoURL });
  }
  writeLocal(stamp, fingerprint);
}

/**
 * The mirror runs fire-and-forget from the auth listener. Anything that patches
 * the profile doc has to wait for it, or the two race to create the same doc
 * and the loser's write is rejected for touching write-once `createdAt`.
 */
let mirrorInFlight: Promise<void> = Promise.resolve();

function readableError(error: unknown): string {
  const code = (error as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match.';
    case 'auth/email-already-in-use':
      return 'That email already has an account. Sign in instead.';
    case 'auth/weak-password':
      return 'Pick a password with at least 6 characters.';
    case 'auth/popup-blocked':
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in window was closed. Try again.';
    case 'auth/operation-not-supported-in-this-environment':
      return 'Google sign-in does not work in this browser. Open the link in Chrome or Safari.';
    default:
      return (error as Error).message || 'Something went wrong. Try again.';
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  displayName: null,
  photoURL: null,
  loading: true,
  error: null,

  signInWithGoogle: async () => {
    set({ error: null });
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // Popups are unreliable on mobile Safari; redirect is the safer path there.
      if (isInAppWebview()) {
        await signInWithRedirect(auth, provider);
        return;
      }
      await signInWithPopup(auth, provider);
    } catch (error) {
      set({ error: readableError(error) });
    }
  },

  signInWithEmail: async (email, password) => {
    set({ error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      set({ error: readableError(error) });
    }
  },

  registerWithEmail: async (email, password, displayName) => {
    set({ error: null });
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) await updateProfile(result.user, { displayName });
    } catch (error) {
      set({ error: readableError(error) });
    }
  },

  /**
   * Writes the name to the Auth profile and to users/{uid} so both agree, then
   * pushes it into the store — the User object mutates in place, so nothing
   * would re-render otherwise.
   */
  updateDisplayName: async (name) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in.');
    const next = name.trim().slice(0, MAX_DISPLAY_NAME);
    if (next === '') throw new Error('Pick a name.');

    await updateProfile(user, { displayName: next });
    await mirrorInFlight;

    // createdAt is write-once: the update rule rejects any write that touches
    // it, so an existing profile is patched rather than merged over.
    const ref = userDoc(user.uid);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, { displayName: next, photoURL: user.photoURL });
    } else {
      await setDoc(ref, { displayName: next, photoURL: user.photoURL, createdAt: serverTimestamp() });
    }

    writeLocal(`user-mirrored:${user.uid}`, `${user.photoURL ?? ''}|${next}`);
    set({ displayName: next });
  },

  signOutUser: async () => {
    await signOut(auth);
  },

  clearError: () => set({ error: null }),
}));

// One listener for the whole app, started at module load. Every sign-in path
// — popup, redirect, email — lands here, so the user doc is mirrored here too.
onAuthStateChanged(auth, (user) => {
  useAuthStore.setState({
    user,
    displayName: user?.displayName ?? null,
    photoURL: user?.photoURL ?? null,
    loading: false,
  });
  if (user) {
    mirrorInFlight = mirrorUserDoc(user).catch(() => undefined);
    void mirrorInFlight;
  }
});
