import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout.js';
import { AuthLayout } from '../components/layout/AuthLayout.js';
import { RedirectIfAuthed } from '../components/layout/RedirectIfAuthed.js';
import { RequireAuth } from '../components/layout/RequireAuth.js';
import { AcceptInvitationPage } from '../pages/AcceptInvitationPage.js';
import { AccountSettingsPage } from '../pages/AccountSettingsPage.js';
import { CanvasPage } from '../pages/CanvasPage.js';
import { ConnectionsPage } from '../pages/ConnectionsPage.js';
import { CredentialsPage } from '../pages/CredentialsPage.js';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage.js';
import { HomePage } from '../pages/HomePage.js';
import { InvitationsPage } from '../pages/InvitationsPage.js';
import { OrganizationSettingsPage } from '../pages/OrganizationSettingsPage.js';
import { ResetPasswordPage } from '../pages/ResetPasswordPage.js';
import { RunDetailPage } from '../pages/RunDetailPage.js';
import { SignInPage } from '../pages/SignInPage.js';
import { SignUpPage } from '../pages/SignUpPage.js';

export const router = createBrowserRouter([
  {
    element: (
      <RedirectIfAuthed>
        <AuthLayout />
      </RedirectIfAuthed>
    ),
    children: [
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/sign-up', element: <SignUpPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
    ],
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'workflows/new', element: <Navigate to="/" replace /> },
      { path: 'workflows/:id', element: <CanvasPage /> },
      { path: 'workflows/:id/connections', element: <Navigate to="/connections" replace /> },
      { path: 'runs/:runId', element: <RunDetailPage /> },
      { path: 'credentials', element: <CredentialsPage /> },
      { path: 'connections', element: <ConnectionsPage /> },
      { path: 'account', element: <AccountSettingsPage /> },
      { path: 'account/organization', element: <OrganizationSettingsPage /> },
      { path: 'account/invitations', element: <InvitationsPage /> },
      { path: 'accept-invitation/:invitationId', element: <AcceptInvitationPage /> },
    ],
  },
]);
