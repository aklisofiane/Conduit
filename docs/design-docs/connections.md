# Connections

How Conduit binds platform credentials to workflows. Two-row model: a rotatable token (`Credential`) and a typed binding on top of it (`Connection`). Workflows reference connections by id from inside `Workflow.definition`.

## Why two rows

A single GitHub PAT is often used for two unrelated things in one workflow — cloning a repo *and* polling a Projects v2 board. The token rotates as one unit; the bindings differ. Splitting into `Credential` (rotatable) + `Connection` (named, typed) means:

- **Rotation propagates.** Updating `Credential.secret` once flows to every Connection that references it. No bake-in.
- **Bindings carry type.** A repo Connection knows its `owner`/`repo`; a board Connection knows its `ownerType`/`owner`/`number`; a GitLab project Connection knows its `projectPath`. Adding a new binding shape (e.g. `slack_workspace`) is a one-file change to the scope union.
- **Workflows reference shared rows.** Two workflows targeting the same repo see the same `Connection` row. Credential rotation, scope edits, and delete-protection all live in one place instead of N per-workflow rows.

The split also pre-aligns with `data-model-partitioning`'s `orgId`: both tables get `orgId` columns later, with the same `@@index([orgId, createdAt])` strategy.

## The typed scope union

`packages/shared/src/connection/scope.ts` owns the union. It ships four variants:

```ts
type ConnectionScope =
  | { kind: 'github_repo'; owner: string; repo: string }
  | { kind: 'github_projects_v2'; ownerType: 'user' | 'org'; owner: string; number: number }
  | { kind: 'gitlab_project'; projectPath: string }   // e.g. "acme/api" or "group/subgroup/api"
  | { kind: 'none' };  // token-only (e.g. Slack workspace today)
```

Discriminated union → consumers always switch over `scope.kind`. A connection with no meaningful binding carries `{ kind: 'none' }` rather than `null` so the switch is exhaustive. `platformForScopeKind(kind)` (same file) maps a scope kind back to its platform (`'github'` for the two GitHub kinds, `'gitlab'` for `gitlab_project`, `undefined` for `none`).

`expectScopeKind(scope, kind)` is a runtime narrowing helper that throws a clean error on mismatch:

```ts
const repo = expectScopeKind(scope, 'github_repo');
// repo is now Extract<ConnectionScope, { kind: 'github_repo' }>
```

Used at activity boundaries — `pollBoardActivity`'s GitHub repo path narrows to `github_repo`, its board branch to `github_projects_v2`, and its GitLab path to `gitlab_project`. Failure surfaces as a worker-side error rather than a silent type-coerce. (The clone path goes through `loadConnectionContext`, which accepts either repo kind directly.)

## How workflows reference connections

`Workflow.definition.triggers[]` carries two named slots:

| Slot | Required | Expected `scope.kind` |
|---|---|---|
| `connectionId` | yes | `github_repo` \| `gitlab_project` — the source binding for issue/PR identity, repo cloning, and label fetches |
| `boardConnectionId` | when mode targets a board | `github_projects_v2` |

A trigger in `polling { source: 'board' }` mode or a webhook trigger on `event: 'board.column.changed'` must carry both. The validator (`packages/shared/src/workflow/validate.ts`) enforces presence; cross-kind validation (e.g. a `boardConnectionId` whose Connection is `github_repo`) happens at the API layer when the row is loaded.

`Workflow.definition.mcpServers[].connectionId` (optional) is also a Connection id. Filtering is platform-only in v1 — a `github` MCP preset accepts any Connection whose `Credential.platform === 'GITHUB'`, regardless of `scope.kind`. Per-preset scope-kind filtering is a follow-up.

## Resolution at runtime

The worker walks `Connection → Credential` once per use:

| File | Purpose |
|---|---|
| `apps/worker/src/runtime/connection-context.ts` | `loadConnectionContext(connectionId)` — workspace-manager hydrator. Accepts `github_repo` **or** `gitlab_project` (for the latter it splits `projectPath` into owner/repo); returns `undefined` for any other kind so the caller throws cleanly. Derives `host` via `normalizeHostUrl` and builds `cloneUrl`; `CONDUIT_TEST_REMOTE_BASE` rebases it onto a local bare repo for E2E. (`loadConnectionHost` resolves just the host for GitLab issue writeback.) |
| `apps/worker/src/runtime/credential-lookup.ts` | `makeCredentialLookup()` — returns a `(connectionId) => Promise<token \| undefined>` for the MCP resolver. Never bakes the token in: every lookup re-reads from Postgres so rotation is immediate. |
| `apps/worker/src/activities/poll-board.ts` | Polling. Walks `connectionId` as the source — `expectScopeKind(..., 'github_repo')` on the GitHub repo / board paths, `'gitlab_project'` on the GitLab path — and, in the board branch, `boardConnectionId` (`github_projects_v2`) for the project number. |

Token decryption uses `@conduit/shared/crypto` so the on-disk format and key resolution stay byte-compatible with the API. See [SECURITY.md](../SECURITY.md).

## Webhook secret moves to `Workflow`

Pre-reshape, the webhook signing secret lived on `WorkflowConnection`. Post-reshape, it lives on `Workflow.webhookSecret` directly. Reasoning:

- There's exactly one webhook URL per workflow (`POST /api/hooks/:workflowId`). The row that authenticates the inbound request is the workflow itself.
- After `data-model-partitioning`, the same row carries `orgId` — verifying the HMAC and resolving the org happen on one row, no extra join.

Verification format (AES-256-GCM ciphertext, HMAC-SHA256 over the raw body) is unchanged. See `apps/api/src/modules/webhooks/webhooks.service.ts`. Rotation is `PUT /api/workflows/:id/webhook-secret`; clearing is `DELETE`. Single secret per workflow — rotating overwrites.

## Delete protection

`DELETE /api/connections/:id` refuses (409) if any workflow's `Workflow.definition` JSON references the row from a trigger or MCP slot. The lookup scans every workflow's definition (no SQL index possible — the references live in JSON), which is fine at v1 scale; partition the search if it shows up in profiles.

The error response lists the blocking workflows by name so the user can detach or reassign them. A richer "show me which workflows" UI is a follow-up.

## OAuth-derived credentials

A `Credential` can be created manually (user pastes a PAT) or automatically when the user signs in with GitHub OAuth. Both produce the same row shape; the OAuth case stamps `metadata.source = 'oauth'` for provenance, with the Better Auth `account.id` carried as the upsert key. The OAuth mirror itself is driven from `auth.config.ts` — see [auth-integration.md > GitHub OAuth → Credential mirror](./auth-integration.md#github-oauth--credential-mirror).

`CredentialsService.upsertOAuthDerived` is idempotent on the carried account id, so re-sign-in updates `secret` + scopes in place rather than spawning duplicates. The credential id is stable across re-auths, so existing Connection rows keep working.

**PAT-rotation converts oauth → manual.** `CredentialsService.update` strips `source` (and the OAuth-only scope record) from `metadata` when the caller rotates the secret on an OAuth-derived row without supplying their own `metadata` patch — claiming OAuth provenance would be misleading once the token is no longer the OAuth access token. Caller-supplied `metadata` always wins. There is no reverse path.

The Settings Credentials list renders an `oauth` badge when `metadata.source === 'oauth'`. Contract tests: `apps/api/test/contract/credentials-oauth-mirror.test.ts`.

## Inline creation from the canvas

The canvas's trigger config panel (`apps/web/src/components/canvas/TriggerConfigPanel.tsx`) and MCP server picker (`apps/web/src/components/canvas/McpServerPicker.tsx`) filter the connection picker by platform and (for triggers) `scope.kind` — the Repo sub-row only shows `github_repo` connections, the Board sub-row only `github_projects_v2`. Both surfaces will gain inline "+ New connection" affordances that commit through `POST /api/connections` and auto-select the new id without leaving the editor; v1 shipped the data model and the management UI at `/settings/integrations` (Credentials + Connections stacked on one surface — see [FRONTEND.md > Screens](../FRONTEND.md#screens)), with the inline modal as a follow-up.

## API surface

Connection / Credential CRUD and the `/workflows/:id/webhook-secret` endpoints live in [ARCHITECTURE.md > API surface](../ARCHITECTURE.md#api-surface). Repo connections also expose a connection-scoped analyze action (`POST/GET /connections/:id/analyze|analysis`) — see [repo-analysis.md](./repo-analysis.md).

## Where the code lives

| Concern | Path |
|---|---|
| Scope union + `expectScopeKind` | `packages/shared/src/connection/scope.ts` |
| Connection CRUD | `apps/api/src/modules/connections/` |
| Credential CRUD + `getConnectionBinding` | `apps/api/src/modules/credentials/` |
| Workflow webhook-secret endpoints | `apps/api/src/modules/workflows/workflows.controller.ts` |
| Worker resolution | `apps/worker/src/runtime/connection-context.ts`, `apps/worker/src/runtime/credential-lookup.ts`, `apps/worker/src/activities/poll-board.ts` |
| Trigger schema slots | `packages/shared/src/trigger/config.ts` |
| Validator | `packages/shared/src/workflow/validate.ts` |
| Template slot enumeration | `packages/shared/src/template/resolve.ts` |
| Web | `apps/web/src/pages/IntegrationsPage.tsx`, `apps/web/src/components/settings/{CredentialsSection,ConnectionsSection}.tsx`, `apps/web/src/components/canvas/TriggerConfigPanel.tsx`, `apps/web/src/components/canvas/McpServerPicker.tsx` |
