# OAuth Sign-In Providers

How to register an OAuth app with a third-party provider and wire it into Conduit so the sign-in screen shows that provider's button. OAuth is **optional** — email/password works out of the box; this is the path that gives you a working GitHub credential (for repos and Projects v2) or GitLab credential (for repos and issues) without pasting a Personal Access Token.

This doc walks through GitHub and GitLab end to end. The two providers are independent — register either, both, or neither.

Everything below is about **gitlab.com** and **github.com**. Self-hosted GitHub Enterprise and self-managed GitLab instances stay PAT-only for now; see the [Alternative: Personal Access Token](#alternative-personal-access-token-no-oauth-setup) section.

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

Token Expiration **Off** is the recommended setup: the token never expires, so nothing has to renew it. If your App has Token Expiration on, sign-in still works — GitHub then issues a refresh token alongside the access token, and Conduit's refresher renews it on the same schedule it uses for GitLab (see [Token expiry is handled for you](#token-expiry-is-handled-for-you)). The refresher is data-driven, not provider-specific: it acts on any account row that has both a refresh token and a recorded expiry.

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

## GitLab

### 1. Create the OAuth application

Go to https://gitlab.com/-/user_settings/applications → **Add new application**. (For a group-owned app: **Group → Settings → Applications**; for a self-managed instance an admin can register it instance-wide under **Admin Area → Applications** — but self-managed GitLab is not wired up yet, see the note at the top.)

| Field | Value |
|---|---|
| Name | Anything — shown on GitLab's authorization screen |
| Redirect URI | `${BETTER_AUTH_URL}/api/auth/callback/gitlab` |
| Confidential | **Checked** — Conduit holds the client secret server-side |
| Scopes | `api`, `read_user` (see [Scopes](#scopes-1)) |

Unlike GitHub, GitLab records the scope set **on the application itself**, so these two boxes have to be ticked here — an app registered without `api` fails at the authorization step, not at first use.

Hit **Save application**, then copy the **Application ID** and **Secret** from the confirmation screen. GitLab shows the secret once.

### 2. Set env vars

```bash
GITLAB_CLIENT_ID="..."      # GitLab calls this the Application ID
GITLAB_CLIENT_SECRET="..."
```

Both must be set — the GitLab button is gated on both being present, in either `local` or `hosted` deployment mode.

### 3. Restart the API

The button now appears on the sign-in screen, and **Settings → Account → Linked accounts** offers **Connect** for GitLab to any already-signed-in user (so an email-signup or GitHub user can add GitLab without a second account). Either route ends in the same place — the first time a GitLab identity is authorized, Conduit:

1. Creates or links the Conduit user (a fresh sign-in also gets a personal organization).
2. Stores the OAuth access token, refresh token, and expiry in Better Auth's `account` table.
3. Mirrors that token into a Conduit `Credential` (visible at **Settings → Integrations**, marked with an `oauth` chip) with `platform: GITLAB` and `hostUrl: gitlab.com`.

### Scopes

The provider is wired to request `api` and `read_user` (the `socialProviders.gitlab.scope` array in `apps/api/src/auth/auth.config.ts`). `api` is GitLab's broad read+write API scope — the rough equivalent of GitHub's `repo` + `project` pair, and what lets workflows clone, push, and move issues/boards. `read_user` is what makes the profile lookup succeed; the mirror reads `https://gitlab.com/api/v4/user` to name the credential after your GitLab username.

Widening the scope set later means editing the registered application's scopes *and* re-linking, since GitLab issues tokens against the app's recorded scopes.

### Token expiry is handled for you

GitLab access tokens expire about two hours after they're issued. You don't have to do anything about that — a background refresher in the API keeps the account (and therefore the mirrored credential) alive:

- **Every 10 minutes** it scans for `account` rows that have both a refresh token and an access token expiring **within the next 30 minutes** (`REFRESH_INTERVAL_MS` / `REFRESH_WINDOW_MS` in `apps/api/src/auth/token-refresh.ts`), oldest expiry first, up to 200 rows per pass.
- Each account is refreshed under a short **per-account Redis lock**, because GitLab refresh tokens are single-use — redeeming one twice from two API processes would burn it. The row is re-checked once the lock is held.
- The renewed token persists through Better Auth's account update, which re-fires the OAuth mirror — so the encrypted `Credential.secret` and its `metadata.tokenExpiresAt` roll forward with no action from you. Credential rows show the resulting "token expires …" hint.
- **If a refresh token dies** (revoked app, revoked session, an unlucky burnt refresh token), the refresher logs a warning and moves on — it never retries into a hard failure and never blocks other accounts. The mirrored credential's expiry then drifts into the past and the row goes **stale** in **Settings → Integrations**, prompting you to re-link the account from **Settings → Account → Linked accounts**. Re-linking updates the existing credential in place; connections pointing at it keep working.

GitHub apps with Token Expiration **Off** never record an expiry, so they're invisible to this sweep — that's by design, not an oversight.

### Git over HTTPS uses `oauth2`

GitLab OAuth tokens are only accepted over HTTPS when paired with the literal username `oauth2` (GitHub uses `x-access-token`). Conduit's credential helper picks the right one from the credential's platform, so a linked GitLab credential clones and pushes with no extra configuration. Worth knowing if you're reproducing a clone by hand:

```bash
git clone https://oauth2:<token>@gitlab.com/<group>/<repo>.git
```

GitLab ignores the username for Personal Access Tokens, so the same helper path works for PAT-backed GitLab credentials too.

## Alternative: Personal Access Token (no OAuth setup)

If you'd rather skip OAuth (or want to script credential provisioning), the PAT path is fully supported:

1. Sign up / sign in with email and password.
2. Go to **Settings → Integrations → Add credential**.
3. Paste a GitHub PAT with `repo`, `project`, and `read:org` scopes, or a GitLab PAT with the `api` scope.

PAT-backed and OAuth-mirrored credentials are functionally identical — every Connection picker, MCP resolver, and worker activity treats them the same. Rotating a PAT into an OAuth-derived credential converts it back to a manual credential automatically.
