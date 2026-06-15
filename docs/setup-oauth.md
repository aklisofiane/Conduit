# OAuth Sign-In Providers

How to register an OAuth app with a third-party provider and wire it into Conduit so the sign-in screen shows that provider's button. OAuth is **optional** — email/password works out of the box; this is the path that gives you a working GitHub credential (for repos and Projects v2) without pasting a Personal Access Token.

This doc walks through GitHub end to end. GitLab OAuth is also wired (`socialProviders.gitlab.scope: ['api', 'read_user']` in `auth.config.ts`) — the GitLab button appears once `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` are set, following the same shape as the GitHub steps below; a dedicated GitLab walkthrough lands here later.

For the architecture behind the sign-in flow and the OAuth → `Credential` mirror, see [design-docs/auth-integration.md](./design-docs/auth-integration.md) and [design-docs/connections.md](./design-docs/connections.md#oauth-derived-credentials).

## Prerequisites

- `BETTER_AUTH_URL` set in `.env` to the public origin your browser hits the API on. Defaults to `http://localhost:3000` in local dev. Every provider's callback URL is derived from this value.
- `BETTER_AUTH_SECRET` set (any provider needs it to sign the session cookie).

## GitHub

### 1. Create the OAuth App

Go to https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**. (For an org-owned app: `https://github.com/organizations/<org>/settings/applications` → **New OAuth App**.)

| Field | Value |
|---|---|
| Application name | Anything — shown on GitHub's consent screen |
| Homepage URL | `${BETTER_AUTH_URL}` — e.g. `http://localhost:3000` |
| Authorization callback URL | `${BETTER_AUTH_URL}/api/auth/callback/github` |
| Enable Device Flow | Leave off |
| **Token Expiration** | **Off** |

Conduit assumes non-expiring user tokens — the OAuth → `Credential` mirror does not refresh tokens. If your registered App has Token Expiration on, sign-in still works but the mirrored credential will silently rot when the token expires. (Tracked as a follow-up in [`.specs/github-oauth-credential.md`](../.specs/github-oauth-credential.md).)

Hit **Register application**, generate a client secret, copy both halves.

### 2. Set env vars

```bash
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."
```

Both must be set — the GitHub button is gated on both being present, in either `local` or `hosted` deployment mode.

### 3. Restart the API

The button now appears on the sign-in screen. The first time a user signs in via GitHub, Conduit:

1. Creates a Conduit user + a personal organization (same as email/password).
2. Stores the OAuth access token in Better Auth's `account` table.
3. Mirrors that token into a Conduit `Credential` (visible at **Settings → Integrations**, marked with an `oauth` chip). This is what lets workflows clone repos and read/write Projects v2 immediately, with no PAT step.

### Scopes

The provider is wired to request `repo`, `project`, `read:org` (the `socialProviders.github.scope` array in `apps/api/src/auth/auth.config.ts`). These cover the surface Conduit's workflows need: code read+write, Projects v2 read+write (workflows update item status, not just read), org-scoped lookups. Existing OAuth users who sign in after a scope change see GitHub's consent screen again — that's expected.

You don't configure scopes on the OAuth App itself; GitHub records what the app *requested* on first consent. To force a re-consent prompt during development, revoke the app at https://github.com/settings/applications and sign in again.

## Alternative: Personal Access Token (no OAuth setup)

If you'd rather skip OAuth (or want to script credential provisioning), the PAT path is fully supported:

1. Sign up / sign in with email and password.
2. Go to **Settings → Integrations → Add credential**.
3. Paste a GitHub PAT with `repo`, `project`, and `read:org` scopes.

PAT-backed and OAuth-mirrored credentials are functionally identical — every Connection picker, MCP resolver, and worker activity treats them the same. Rotating a PAT into an OAuth-derived credential converts it back to a manual credential automatically.
