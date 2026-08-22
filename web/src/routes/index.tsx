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
import { SettleUpPage } from '../features/expense/SettleUpPage.js';

const protect = (element: React.ReactNode) => <RequireAuth>{element}</RequireAuth>;

export const router = createBrowserRouter([
  { path: '/signin', element: <SignInPage /> },
  // Join handles its own signed-out state so the invite survives sign-in.
  { path: '/join/:groupId/:token', element: <JoinPage /> },
  { path: '/', element: protect(<HomePage />) },
  { path: '/new', element: protect(<CreateGroupPage />) },
  { path: '/profile', element: protect(<ProfilePage />) },
  { path: '/group/:id', element: protect(<GroupPage />) },
  { path: '/group/:id/members', element: protect(<MembersPage />) },
  { path: '/group/:id/add', element: protect(<AddExpensePage />) },
  { path: '/group/:id/settle', element: protect(<SettleUpPage />) },
  { path: '*', element: <Navigate to="/" replace /> },
]);
