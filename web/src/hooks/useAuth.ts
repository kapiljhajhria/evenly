import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../stores/auth.js';

export function useAuth() {
  return useAuthStore(
    useShallow((state) => ({
      user: state.user,
      // Read these rather than user.displayName: the User object is mutated in
      // place by updateProfile, so it never triggers a re-render on its own.
      displayName: state.displayName,
      photoURL: state.photoURL,
      loading: state.loading,
      error: state.error,
    })),
  );
}

export function useAuthActions() {
  return useAuthStore(
    useShallow((state) => ({
      signInWithGoogle: state.signInWithGoogle,
      signInWithEmail: state.signInWithEmail,
      registerWithEmail: state.registerWithEmail,
      updateDisplayName: state.updateDisplayName,
      signOutUser: state.signOutUser,
      clearError: state.clearError,
    })),
  );
}
