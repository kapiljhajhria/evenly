import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { FullPageSpinner } from '../../components/ui.js';

/** Never redirect while auth is still resolving — that logs people out on reload. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
