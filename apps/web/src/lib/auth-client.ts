/**
 * Better Auth React client. Single instance, configured against the API
 * base URL (which is where Better Auth's `/api/auth/*` routes are mounted by
 * the API process). The session cookie is set by Better Auth on sign-up /
 * sign-in responses; subsequent requests carry it because the underlying
 * `BetterFetch` defaults to `credentials: 'include'` and `apps/web/src/api/
 * client.ts` does the same for the rest of the API surface.
 */
import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import { apiBaseUrl } from '../api/client.js';

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  plugins: [organizationClient()],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  requestPasswordReset,
  resetPassword,
  // Account linking (`/settings/account` → Linked accounts, plus the Connect
  // shortcuts on `/settings/integrations`). `linkSocial` mirrors `signIn.social`
  // for an already-signed-in user: it returns `{ url, redirect }` and the
  // client's redirect fetch-plugin navigates the browser to the provider.
  linkSocial,
  listAccounts,
  unlinkAccount,
} = authClient;
