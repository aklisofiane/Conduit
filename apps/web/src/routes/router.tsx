import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout.js';
import { AuthLayout } from '../components/layout/AuthLayout.js';
import { RedirectIfAuthed } from '../components/layout/RedirectIfAuthed.js';
import { RequireAuth } from '../components/layout/RequireAuth.js';
import { SettingsLayout } from '../components/layout/SettingsLayout.js';
import { AcceptInvitationPage } from '../pages/AcceptInvitationPage.js';
import { AccountSettingsPage } from '../pages/AccountSettingsPage.js';
import { ApiKeysPage } from '../pages/ApiKeysPage.js';
import { CanvasPage } from '../pages/CanvasPage.js';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage.js';
import { HomePage } from '../pages/HomePage.js';
import { IntegrationsPage } from '../pages/IntegrationsPage.js';
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
      { path: 'runs/:runId', element: <RunDetailPage /> },
      { path: 'credentials', element: <Navigate to="/settings/integrations" replace /> },
      { path: 'connections', element: <Navigate to="/settings/integrations" replace /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/account" replace /> },
          { path: 'account', element: <AccountSettingsPage /> },
          { path: 'integrations', element: <IntegrationsPage /> },
          { path: 'api-keys', element: <ApiKeysPage /> },
          { path: 'organization', element: <OrganizationSettingsPage /> },
          { path: 'invitations', element: <InvitationsPage /> },
        ],
      },
      { path: 'account', element: <Navigate to="/settings/account" replace /> },
      { path: 'account/organization', element: <Navigate to="/settings/organization" replace /> },
      { path: 'account/invitations', element: <Navigate to="/settings/invitations" replace /> },
      { path: 'accept-invitation/:invitationId', element: <AcceptInvitationPage /> },
    ],
  },
]);
