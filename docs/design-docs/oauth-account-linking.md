# OAuth Account Linking

Linking and unlinking GitHub / GitLab identities from inside the app, and keeping the resulting token alive long enough to be useful as a git credential. Sign-in already produced a mirrored `Credential` for whichever provider you signed in *with*; this sub-feature covers the other cases — an email-signup user adding GitHub later, a GitHub user adding GitLab, and any linked GitLab token surviving past the ~2h mark it would otherwise die at.

Distinct from [auth-integration.md](./auth-integration.md), which owns the Better Auth mount and the first-sign-in path. Everything here is about the *second* identity and the token's life after it lands.

## Why this needed work

Better Auth already had the pieces — both social providers, `accountLinking` with both trusted, and the `account` → `Credential` mirror. Three gaps made linking unusable in practice:

| Gap | Consequence |
|---|---|
| Client methods unexported | No way to link from the UI at all; sign-in was the only path to a linked identity. |
| Nothing refreshed the token | A linked GitLab credential worked for ~2h, then silently failed every clone. |
| Git username hardcoded to `x-access-token` | GitLab rejects that over HTTPS — the credential couldn't clone or push even while fresh. |

Unlink also left the mirrored `Credential` behind, so a "removed" identity kept a live token in the credential list.

## The two surfaces

Deliberately asymmetric — one place owns the lifecycle, the other is a shortcut:

| Surface | Offers | Why |
|---|---|---|
| **Settings → Account → Linked accounts** | Link **and** unlink, one row per advertised provider | Source of truth. Unlink lives here only, so there's a single place to reason about the destructive path. |
| **Settings → Integrations**, above the PAT form | Link only (**Connect GitHub / GitLab**) | Discoverability: the user is already looking at credentials and about to paste a PAT by hand. A second unlink surface would just duplicate the confirm dialog. |

Both gate on `oauthProviders` from `useAuthConfig()` — the same runtime gate the sign-in buttons use, so an unconfigured provider never renders. Both funnel into Better Auth's `linkSocial`, which reuses the scopes already registered for the provider; the existing `account.create.after` mirror turns the new link into a usable `Credential` with no linking-specific write path.

The browser-side logic (which providers are linkable, which credential mirrors which account, how Better Auth's error codes read to a human) lives React-free in `apps/web/src/lib/account-linking.ts` so it can be unit-tested without rendering.

## Unlink: refuse while referenced

Better Auth blocks unlinking the *last* remaining account on its own (`FAILED_TO_UNLINK_LAST_ACCOUNT`). What it doesn't know about is the mirrored `Credential` and anything pointing at it, so `databaseHooks.account.delete` closes that loop:

```
unlink request
   ├─ delete.before → find mirrored Credential by metadata.accountRowId
   │                  └─ referenced by Connections? → throw APIError(CONFLICT), naming them
   └─ delete.after  → delete the mirrored Credential   (runs post-commit)
```

This mirrors `CredentialsService.delete()`'s existing refuse-while-referenced posture, so credentials behave the same however you try to remove them.

Two constraints worth knowing before touching this hook:

- **Throw, don't return `false`.** Returning `false` from a `delete.before` hook aborts the delete *silently* — the caller gets `null` and the user sees a no-op. Only a thrown `APIError` carries the message naming the blocking connections.
- **The same hook fires on user deletion.** Full-user-deletion deletes account rows through the same model, so an unqualified block would make deleting a user impossible. The guard is scoped to the unlink request path; cascading deletion stands down deliberately.

## Which org the credential lands in

The mirror originally always wrote to the user's personal org, which is right for first sign-in and wrong for in-app linking — a user linking while working in a shared org would find the credential somewhere they weren't looking.

Org resolution now walks: the hook context's session → the session resolved from request headers → the personal org. A resolved org is only accepted if the user still has a `Member` row for it, so neither a mismatched session nor a stale `activeOrganizationId` can place a credential somewhere the user isn't a member. See [authorization-enforcement.md § Trust contract](./authorization-enforcement.md#trust-contract) for why membership is otherwise trusted per-session rather than re-checked per-request.

**The header fallback is load-bearing, not belt-and-braces.** Better Auth populates `context.session` from its session middleware, which the OAuth *callback* route never runs — and the callback is exactly where the link's `account.create` fires. Reading the context session alone would always fall through to the personal org. The callback is a top-level same-site navigation, so it still carries the session cookie, which is what the fallback reads.

Re-mirroring never moves an existing row: the upsert is keyed on the account row id and the lookup is org-agnostic, so the org is decided once, when the credential is first created.

## Token refresh

A background sweep in the API (`apps/api/src/auth/token-refresh.ts`, wired by `token-refresh.service.ts`) keeps expiring tokens alive:

| Property | Value | Why |
|---|---|---|
| Interval | 10 min | Comfortably inside the refresh window. |
| Refresh window | expiry within 30 min | Room for several retries before a token actually dies. |
| Batch cap | 200 rows, soonest expiry first | A backlog can't monopolize a process. |
| Failure handling | log and continue | One dead refresh token must not stall every other account. |

The sweep is **data-driven, not provider-specific**: an account is refreshed when it has both a refresh token and a recorded expiry. GitHub apps configured the documented way ("Token Expiration: Off") never record an expiry and so are invisible to it — the no-op is a consequence of the data, not a provider branch. GitLab always records one and refreshes indefinitely off its rotating refresh token.

Refreshed tokens persist through Better Auth's account update, which re-fires the existing `account.update.after` hook — so `Credential.secret` and its expiry roll forward through the same mirror as everything else. There is no refresh-specific mirror code, and that's the point.

### The Redis lock is not optional

GitLab refresh tokens are **single-use**. Two hosted API processes sweeping the same account race, the loser redeems an already-burned token, and the user has to re-link. A short per-account Redis lock (`SET NX PX`, on the client already present for Better Auth's `secondaryStorage`) serializes the sweep.

Two details that look defensive but aren't:

- **Re-check the row once the lock is held.** Another process may have refreshed it between the scan and the lock.
- **Release is a compare-and-delete (Lua), never a plain `DEL`.** If our lock already expired and another process took it, a bare delete would drop *their* lock and reintroduce the race it exists to prevent.

Everything in the sweep is dependency-injected, so it tests without a scheduler, Redis, or a live provider.

## Staleness surfaces in the UI

`upsertOAuthDerived` records the token's expiry in `Credential.metadata`, which is all the UI needs to distinguish three states (`apps/web/src/lib/credential-staleness.ts`): fresh, expiring, and past-expiry. A past-expiry OAuth credential means refresh has been failing — a revoked app, a revoked session, or a burned refresh token — so the row goes stale and prompts a re-link, routing back into the same `linkSocial` flow. Re-linking updates the credential in place, so dependent connections keep working.

This is the only user-visible signal that refresh died; the refresher itself never escalates.

## Git over HTTPS: the username matters

GitLab accepts an OAuth token over HTTPS **only** when paired with the literal username `oauth2`; GitHub conventionally uses `x-access-token`. Both credential-helper paths — worker-side clone/fetch and the agent-side push script — resolve the username from the connection's platform through one shared helper (`packages/agent/src/workspace/git-username.ts`) so the two can't drift.

`oauth2` is also correct for GitLab **PATs** (GitLab ignores the username for those), so the helper needs only the platform, never which kind of token it's holding.

The platform is a required argument rather than a defaulted one — a default would let a missed call site silently keep the old behavior, which is precisely the bug this fixes.

## Where the code lives

```
apps/api/src/auth/
├── oauth-mirror-hooks.ts     ← account.{create,update}.after mirror + delete.{before,after} unlink
├── token-refresh.ts          ← the sweep: scan, lock, refresh, log (injectable, no I/O of its own)
├── token-refresh.service.ts  ← Nest interval + Redis + Better Auth wiring
└── token-refresh-lock.ts     ← per-account Redis lock (SET NX PX + compare-and-delete release)

apps/web/src/
├── lib/account-linking.ts               ← React-free linking logic
├── lib/credential-staleness.ts          ← expiry → fresh / expiring / stale
├── api/linked-accounts.ts               ← TanStack Query over listAccounts + unlinkAccount
├── api/auth-result.ts                   ← Better Auth {data,error} → throw/return
├── hooks/use-oauth-link-return.ts       ← OAuth return markers, refetches credentials
└── components/settings/                 ← LinkedAccountsSection, ConnectOAuthButtons, OAuthCredentialStatus

packages/agent/src/workspace/git-username.ts   ← platform → oauth2 | x-access-token
```

Operator-facing setup (registering the apps, callback URLs, scopes) is [setup-oauth.md](../setup-oauth.md). The `Credential` side of the mirror contract is [connections.md § OAuth-derived credentials](./connections.md#oauth-derived-credentials).

## Out of scope

- **Self-hosted GHE / self-managed GitLab OAuth** — stays PAT-only; parked with the rest of the multi-instance work.
- **Multiple accounts per provider per user** — one linked identity per provider.
- **Moving credentials between orgs** — the org is decided at creation and never migrates.
- **Login flow changes**, including auto-link-on-matching-email, which shipped earlier and is unchanged.
