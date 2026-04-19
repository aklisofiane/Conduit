import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout.js';
import { CanvasPage } from '../pages/CanvasPage.js';
import { ConnectionsPage } from '../pages/ConnectionsPage.js';
import { CredentialsPage } from '../pages/CredentialsPage.js';
import { HomePage } from '../pages/HomePage.js';
import { RunDetailPage } from '../pages/RunDetailPage.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'workflows/new', element: <Navigate to="/" replace /> },
      { path: 'workflows/:id', element: <CanvasPage /> },
      { path: 'workflows/:id/connections', element: <ConnectionsPage /> },
      { path: 'runs/:runId', element: <RunDetailPage /> },
      { path: 'credentials', element: <CredentialsPage /> },
    ],
  },
]);
