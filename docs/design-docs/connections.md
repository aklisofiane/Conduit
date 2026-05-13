# Connections

How Conduit binds platform credentials to workflows. Two-row model: a rotatable token (`Credential`) and a typed binding on top of it (`Connection`). Workflows reference connections by id from inside `Workflow.definition`.

## Why two rows

A single GitHub PAT is often used for two unrelated things in one workflow — cloning a repo *and* polling a Projects v2 board. The token rotates as one unit; the bindings differ. Splitting into `Credential` (rotatable) + `Connection` (named, typed) means:

- **Rotation propagates.** Updating `Credential.secret` once flows to every Connection that references it. No bake-in.
- **Bindings carry type.** A repo Connection knows its `owner`/`repo`; a board Connection knows its `ownerType`/`owner`/`number`. Adding a new binding shape (e.g. `slack_workspace`, `gitlab_repo`) is a one-file change to the scope union.
- **Workflows reference shared rows.** Two workflows targeting the same repo see the same `Connection` row. Credential rotation, scope edits, and delete-protection all live in one place instead of N per-workflow rows.

The split also pre-aligns with `data-model-partitioning`'s `orgId`: both tables get `orgId` columns later, with the same `@@index([orgId, createdAt])` strategy.

## The typed scope union

`packages/shared/src/connection/scope.ts` owns the union. v1 ships three variants:

```ts
type ConnectionScope =
  | { kind: 'github_repo'; owner: string; repo: string }
  | { kind: 'github_projects_v2'; ownerType: 'user' | 'org'; owner: string; number: number }
  | { kind: 'none' };  // token-only (e.g. Slack workspace today)
```

Discriminated union → consumers always switch over `scope.kind`. A connection with no meaningful binding carries `{ kind: 'none' }` rather than `null` so the switch is exhaustive.

`expectScopeKind(scope, kind)` is a runtime narrowing helper that throws a clean error on mismatch:

```ts
const repo = expectScopeKind(scope, 'github_repo');
// repo is now Extract<ConnectionScope, { kind: 'github_repo' }>
```

Used at activity boundaries — the `repo-clone` workspace path requires `github_repo`, `pollBoardActivity`'s board branch requires `github_projects_v2`. Failure surfaces as a worker-side error rather than a silent type-coerce.

## How workflows reference connections

`Workflow.definition.triggers[]` carries two named slots:

| Slot | Required | Expected `scope.kind` |
|---|---|---|
| `connectionId` | yes | `github_repo` (today) — the source binding for issue/PR identity, repo cloning, and label fetches |
| `boardConnectionId` | when mode targets a board | `github_projects_v2` |

A trigger in `polling { source: 'board' }` mode or a webhook trigger on `event: 'board.column.changed'` must carry both. The validator (`packages/shared/src/workflow/validate.ts`) enforces presence; cross-kind validation (e.g. a `boardConnectionId` whose Connection is `github_repo`) happens at the API layer when the row is loaded.

`Workflow.definition.mcpServers[].connectionId` (optional) is also a Connection id. Filtering is platform-only in v1 — a `github` MCP preset accepts any Connection whose `Credential.platform === 'GITHUB'`, regardless of `scope.kind`. Per-preset scope-kind filtering is a follow-up.

## Resolution at runtime

The worker walks `Connection → Credential` once per use:

| File | Purpose |
|---|---|
| `apps/worker/src/runtime/connection-context.ts` | `loadConnectionContext(connectionId)` — workspace-manager hydrator. Requires `github_repo`; returns `undefined` for any other kind so the caller throws cleanly. Builds `cloneUrl` from `owner`/`repo`; `CONDUIT_TEST_REMOTE_BASE` rebases it onto a local bare repo for E2E. |
| `apps/worker/src/runtime/credential-lookup.ts` | `makeCredentialLookup()` — returns a `(connectionId) => Promise<token \| undefined>` for the MCP resolver. Never bakes the token in: every lookup re-reads from Postgres so rotation is immediate. |
| `apps/worker/src/activities/poll-board.ts` | Polling. Walks `connectionId` (source — must be `github_repo` for repo / PR paths) and, in the board branch, `boardConnectionId` (must be `github_projects_v2`) to get owner/repo/project number. |

Token decryption uses `@conduit/shared/crypto` so the on-disk format and key resolution stay byte-compatible with the API. See [SECURITY.md](../SECURITY.md).

## Webhook secret moves to `Workflow`

Pre-reshape, the webhook signing secret lived on `WorkflowConnection`. Post-reshape, it lives on `Workflow.webhookSecret` directly. Reasoning:

- There's exactly one webhook URL per workflow (`POST /api/hooks/:workflowId`). The row that authenticates the inbound request is the workflow itself.
- After `data-model-partitioning`, the same row carries `orgId` — verifying the HMAC and resolving the org happen on one row, no extra join.

Verification format (AES-256-GCM ciphertext, HMAC-SHA256 over the raw body) is unchanged. See `apps/api/src/modules/webhooks/webhooks.service.ts`. Rotation is `PUT /api/workflows/:id/webhook-secret`; clearing is `DELETE`. Single secret per workflow — rotating overwrites.

## Delete protection

`DELETE /api/connections/:id` refuses (409) if any workflow's `Workflow.definition` JSON references the row from a trigger or MCP slot. The lookup scans every workflow's definition (no SQL index possible — the references live in JSON), which is fine at v1 scale; partition the search if it shows up in profiles.

The error response lists the blocking workflows by name so the user can detach or reassign them. A richer "show me which workflows" UI is a follow-up.

## Inline creation from the canvas

The canvas's trigger config panel (`apps/web/src/components/canvas/TriggerConfigPanel.tsx`) and MCP server picker (`apps/web/src/components/canvas/McpServerPicker.tsx`) filter the connection picker by platform and (for triggers) `scope.kind` — the Repo sub-row only shows `github_repo` connections, the Board sub-row only `github_projects_v2`. Both surfaces will gain inline "+ New connection" affordances that commit through `POST /api/connections` and auto-select the new id without leaving the editor; v1 shipped the data model and the management UI at `/settings/integrations` (Credentials + Connections stacked on one surface — see [FRONTEND.md > Screens](../FRONTEND.md#screens)), with the inline modal as a follow-up.

## API surface

| Method | Path | Body / params |
|---|---|---|
| `GET` | `/api/connections` | Optional `?platform=GITHUB`, `?scopeKind=github_repo` filters |
| `GET` | `/api/connections/:id` | One connection with joined credential summary |
| `POST` | `/api/connections` | `{ credentialId, name, scope }` |
| `PATCH` | `/api/connections/:id` | `{ credentialId?, name?, scope? }` |
| `DELETE` | `/api/connections/:id` | 409 + blocker list if referenced |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/credentials[/:id]` | `Credential` CRUD; rotation propagates to every Connection |
| `PUT` | `/api/workflows/:id/webhook-secret` | `{ secret }` — encrypts and stores on `Workflow.webhookSecret` |
| `DELETE` | `/api/workflows/:id/webhook-secret` | Clears the column |

See [ARCHITECTURE.md > API surface](../ARCHITECTURE.md#api-surface) for the full route table.

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
