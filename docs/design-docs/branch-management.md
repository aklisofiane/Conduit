# Branch Management

How Conduit handles branches for iterative board-loop workflows. Covers the `ticket-branch` workspace kind, ownership, lifecycle, and concurrency.

## Core principle: the board is the loop

Iteration is expressed by board transitions, not by cycles in the workflow graph. A Worker workflow fires on `status = Dev`, commits to a persistent branch, and moves the ticket to `AIReview`. A Critic workflow fires on `status = AIReview` and either approves (moves to `ReadyToMerge`) or rejects (moves the ticket back to `Dev`, re-triggering the Worker).

Cross-run state lives in two platform-native places:

- **The branch** — code state, written by Worker agents via commits.
- **The ticket / PR** — review state, written by Critic agents via comments.

Conduit is stateless across runs. `.conduit/` remains intra-run only. No cycle edges, no loop nodes, no Conduit-owned cross-run blob store.

## `ticket-branch` workspaces

Declared in [node-system.md](./node-system.md):

```ts
| { kind: 'ticket-branch'; connectionId: string; baseRef?: string }
```

At runtime, `runAgentNode`:

1. Derives the branch name (`conduit/<ticket-id>-<slug>`).
2. Checks the remote — adds a worktree from the branch if it exists, or creates it with `-b <baseRef>` if it doesn't. When `baseRef` is omitted, the runtime reads the base clone's `HEAD` symbolic ref to resolve the repo's default branch (typically `main`). The resolved ref is cached in `TicketBranch.baseRef` for display.
3. Injects a platform token into the agent process env and configures a git credential helper so the agent can `git push`.

**First-create-wins for `baseRef`**: the `TicketBranch` row is shared across workflows targeting the same ticket. The first workflow to create the branch writes its `baseRef` to the row; subsequent workflows targeting the same ticket ignore their own declared `baseRef` and resolve to the existing branch. The branch, once created, is the source of truth — it's too late to change its base.

Validation at save time: `ticket-branch` requires a trigger that carries an issue/PR identifier.

## Ownership model

`conduit/*` branches are **machine-owned by convention**. Humans interact through:

- PR review comments (read by the next Worker iteration).
- Ticket comments (same).
- Board transitions (trigger or end workflows).

**Takeover escape hatch**: to take over, branch off the Conduit branch to something like `takeover/<ticket>` and move the ticket out of AI columns. The column transition is the gate — Conduit stops triggering on that ticket and stops touching the branch.

Conduit does **not** install server-side branch protection on `conduit/*` in v1. Ownership is convention, not enforcement. If accidental-push incidents become a real pain point, revisit with an opt-in UI toggle (requires admin scope on the platform token).

## Branch naming

Format: `conduit/<ticket-id>-<slug>`.

- `ticket-id` is `TriggerEvent.issue.key` — the user-visible identifier as a string (`"42"` for GitHub, `"PROJ-123"` for Jira). Never the opaque `issue.id`. The same value is used for the `TicketBranch` row key and the Temporal workflow ID, so branch naming, DB lookup, and the concurrency guard all converge on one identifier.
- `slug` is derived from the ticket title at first creation — kebab-case, truncated to ~40 chars. **Stored once** in a `TicketBranch` DB row keyed by `(platform, owner, repo, ticketId)`, so the branch name is stable across runs even if the title changes. Keying at the repo+ticket level (not per-workflow) means Worker and Critic workflows targeting the same ticket converge on the same row and the same branch.
- No platform prefix. The workflow's connection already implies the platform.

## Lifecycle

**Create**: first Worker run on the ticket. Runtime creates the `TicketBranch` row and runs `git worktree add -b conduit/<ticket-id>-<slug> <tmpdir> <baseRef>` off the base clone.

**Commit**: agent does normal `git commit` during its run. No runtime involvement.

**Push**: agent does `git push` via shell. Auth comes from a platform token in the agent process env, read via a git credential helper at push time. Token is never written to `.git/config` or the remote URL. See [SECURITY.md](../SECURITY.md#credential-storage) for the full credential model.

*Non-fast-forward gotcha*: if someone (or some other workflow) has pushed to the branch since this run resolved its worktree, `git push` is rejected as non-fast-forward. The agent sees this as a normal shell error and can `git fetch origin <branch>` + rebase before retrying. Conduit never force-pushes on the agent's behalf.

*Who pushes*: any agent whose worktree traces back to a `ticket-branch` ancestor can `git push` — push env + credential helper flow through the inherit chain. Convention is that the agent making the final commit pushes, typically also the one posting ticket comments and moving the board column. No runtime enforcement: DAGs with multiple terminal agents work (fast-forward push is idempotent), and the unpushed-commits check catches the "nobody pushed" case. A save-time `pushes: true` flag on the workspace spec to designate a single pusher is a deferred option (see [PLANS.md](../PLANS.md)).

*Footgun*: if no agent in the workflow runs `git push`, commits accumulate locally and are lost when the next run resolves a fresh worktree from the remote. The runtime does not enforce a push. To surface this early, `cleanupRunActivity` does a local-only check at run end (no `git fetch`): if the remote-tracking ref is missing, everything local is treated as unpushed; otherwise it diffs `origin/<branch>..HEAD`. A warning is emitted to `ExecutionLog` without blocking the run. See [agent-execution.md](./agent-execution.md).

*PR creation*: Conduit does not auto-open a PR. The Worker agent's instructions are expected to handle this on first push (e.g., "if no PR exists for this branch, open a draft PR"). The shipped `board-loop` template (Phase 6) includes this pattern.

**Delete**: **not automatic in v1.** Branches persist until manually deleted. Branches are cheap; auto-janitors that watch PR merge + ticket close + cooling-off add a whole subsystem for modest ergonomic gain. Revisit in a later phase.

## Concurrency

**Concurrent triggers on the same ticket (same workflow)**: one active run per `(workflow, ticket)` at a time. The workflow ID is deterministic: `run-<workflowId>-<ticketId>`. While a run is in flight, Temporal rejects a duplicate start with `WorkflowExecutionAlreadyStarted` — the trigger handler catches it, drops the trigger silently (no new `WorkflowRun` row, no error surfaced to the platform). Once the run terminates (any status), `WorkflowIdReusePolicy = ALLOW_DUPLICATE` lets the same ID be reused, so a ticket re-entering `Dev` fires the Worker again. This is what keeps board cycles (Dev → Review → Dev) working. Applies only to `ticket-branch` workflows; ephemeral `repo-clone` workflows use per-run workflow IDs and allow concurrent runs.

**Base-clone race on the same host**: two activities (different tickets, same repo) might call `git worktree add` against the shared base clone at the same moment. A local file lock on the base-clone path serializes these. Local-process only, not distributed.

**Push conflicts**: if a retry-scenario causes two push attempts with different parents, git rejects the non-fast-forward push naturally. Conduit never force-pushes. The retried activity picks up the current remote state on its next worktree resolve.

Deferred to a later phase (documented as known gaps):

- Deduplication of redundant queued runs (e.g., collapsing a webhook storm into one run).
- Backpressure on high-frequency triggers.

## Drift from `main`

In v1, Conduit does not auto-rebase `conduit/*` branches as `main` advances. Drift manifests as a PR conflict when the branch is eventually merged; humans (or a future janitor) resolve it.

Auto-rebase is deferred — the conflict-resolution logic is non-trivial (requires an LLM pass for anything beyond trivial cases) and not load-bearing for the pattern to be useful.

## Secret scanning

Not a Conduit-level feature in v1. Users enabling `ticket-branch` workflows should enable GitHub's native push-protection secret scanning on the repos those workflows target. Conduit does not add a second layer.

Rationale: the agent can leak secrets through many paths (ticket comments, PR body, `.conduit/` summary) beyond git commits. A scanner on the push diff alone is partial coverage, and building a properly unbypassable scanner requires runtime-owned push — a larger architectural commitment. The platform-native scanners already exist; use them.

## Platform notes

v1 targets **GitHub** exclusively. GitHub unifies issues and git branches under one connection and exposes threaded PR review comments — the structured feedback surface the Critic needs for discrete, per-point iteration.

GitLab is the planned fast-follow: same single-connection shape, same PR-review comment threading, so it slots into the board-loop pattern without schema changes. Adding it is a matter of wiring the trigger/webhook/MCP surface, not rethinking the model.

Ticket-only platforms (Jira, Linear) are deferred further. Supporting them cleanly requires splitting `ticket-branch` across two connections (ticket platform + git host, e.g. Jira + Bitbucket) and a weaker Critic loop routed through flat ticket comments — both worth designing deliberately rather than retrofitting.

## Gaps explicitly deferred

- Auto-delete of `conduit/*` branches after PR merge + ticket close.
- Auto-rebase on drift from `main`.
- Deduplication of queued runs beyond the workflow-ID uniqueness gate.
- Webhook storm collapse / backpressure.
- Branch-protection automation on `conduit/*`.
- Ticket-only platforms (Jira, Linear) where tickets and branches live on different hosts — requires a second connection on the workspace spec and a weaker Critic loop via flat comments.
- `TicketBranch` row cleanup — rows accumulate monotonically in v1 (one per ticket ever touched). Rows are small and bounded by per-repo ticket volume; auto-cleanup lands alongside branch auto-deletion.

## Not features

- No Conduit-owned cross-run blob store (DB blobs, extended `.conduit/` persistence).
- No cycle edges or loop nodes in the workflow graph.
- No runtime-owned push step. Agents push via git themselves.
- No mandatory human push protection on `conduit/*`. Convention only.
