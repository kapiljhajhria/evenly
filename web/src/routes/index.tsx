import { createBrowserRouter, Navigate } from 'react-router';
import { RequireAuth } from '../features/auth/RequireAuth.js';
import { SignInPage } from '../features/auth/SignInPage.js';
import { JoinPage } from '../features/join/JoinPage.js';
import { HomePage } from '../features/group/HomePage.js';
import { CreateGroupPage } from '../features/group/CreateGroupPage.js';
import { ProfilePage } from '../features/profile/ProfilePage.js';
import { GroupPage } from '../features/group/GroupPage.js';
import { MembersPage } from '../features/group/MembersPage.js';
import { AddExpensePage } from '../features/expense/AddExpensePage.js';
import { EditExpensePage } from '../features/expense/EditExpensePage.js';
import { SettleUpPage } from '../features/expense/SettleUpPage.js';
import { DeletedPage } from '../features/expense/DeletedPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';
import { LandingPage } from '../features/landing/LandingPage.js';
import { useAuth } from '../hooks/useAuth.js';
import { FullPageSpinner } from '../components/ui.js';

const protect = (element: React.ReactNode) => <RequireAuth>{element}</RequireAuth>;

/** Signed in: your groups. Signed out: the front page, rather than a bare sign-in form. */
function Root() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return user ? <HomePage /> : <LandingPage />;
}

export const router = createBrowserRouter([
  { path: '/signin', element: <SignInPage /> },
  // Join handles its own signed-out state so the invite survives sign-in.
  { path: '/join/:groupId/:token', element: <JoinPage /> },
  { path: '/about', element: <LandingPage /> },
  { path: '/', element: <Root /> },
  { path: '/new', element: protect(<CreateGroupPage />) },
  { path: '/profile', element: protect(<ProfilePage />) },
  { path: '/settings', element: protect(<SettingsPage />) },
  { path: '/group/:id', element: protect(<GroupPage />) },
  { path: '/group/:id/members', element: protect(<MembersPage />) },
  { path: '/group/:id/add', element: protect(<AddExpensePage />) },
  { path: '/group/:id/settle', element: protect(<SettleUpPage />) },
  { path: '/group/:id/deleted', element: protect(<DeletedPage />) },
  { path: '/group/:id/expense/:expenseId', element: protect(<EditExpensePage />) },
  { path: '*', element: <Navigate to="/" replace /> },
]);
