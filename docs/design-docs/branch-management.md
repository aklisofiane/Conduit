# Branch Management

How Conduit handles branches for iterative board-loop workflows. Covers the `ticket-branch` workspace kind, ownership, lifecycle, and concurrency.

## Core principle: the board is the loop

Iteration is expressed by board transitions, not by cycles in the workflow graph (the model is owned by [VISION.md](../VISION.md#core-principles) and [node-system.md](./node-system.md#cross-run-iteration)). The branch-specific consequence: cross-run state lives in two platform-native places — **the branch** (code state, Worker commits) and **the ticket / PR** (review state, Critic comments). Conduit is stateless across runs; `.conduit/` stays intra-run only; no cycle edges, no loop nodes, no Conduit-owned blob store. AI-to-AI handoffs ride `conduit-*` labels (not board status) so the convention works identically on GitHub and GitLab — see [Label-gated signaling](./templates.md#label-gated-signaling); human-gesture entry points (a freshly opened issue) still gate on status.

## `ticket-branch` workspaces

Declared in [node-system.md](./node-system.md):

```ts
| { kind: 'ticket-branch' }
```

The trigger event determines which arm runs:

- **Issue trigger** (`issues.opened` webhook, polling on board status):
  1. Derive the branch name (`conduit/<ticket-id>-<slug>`).
  2. Upsert the `TicketBranch` row — first call writes the slug + base ref; later calls return the row verbatim so name and base stay stable across workflows.
  3. Check the remote — add a worktree from the branch if it exists, or create it with `-b <baseRef>` if it doesn't. The base ref defaults to the repo default (the base clone's `HEAD` symbolic ref, typically `main`), but can be overridden per-ticket by a `conduit:base` body marker — see [Base ref selection](#base-ref-selection).
- **PR trigger** (`pull_request.opened` webhook): no row, no slug. Add a worktree directly at `pr.headRef` after fetching. For Conduit-internal flows where a Worker pushed and opened a PR, this lands the Reviewer on the same `conduit/<id>-<slug>` branch the Worker built; for external/human-opened PRs, on whatever ref the contributor opened from.

In both arms, the runtime injects a platform token into the agent process env and configures a git credential helper so the agent can `git push`. The connection comes from the workflow's single trigger configuration — agents and the workspace itself no longer carry a `connectionId`.

**First-create-wins for `baseRef`** (issue arm only): the `TicketBranch` row is shared across workflows targeting the same ticket. The first workflow to create the branch writes its `baseRef`; subsequent workflows resolve to the existing branch. The branch, once created, is the source of truth.

## Base ref selection

By default the issue arm bases the branch off the repo default. A ticket can override this by carrying a **base marker** on its issue body, so work spawned from a non-default branch (e.g. a `cron` trigger running on `branch-2`) lands on top of that branch instead of `main`. The PR arm already has this property natively — it bases off `pr.baseRef` — but issues have no native base-ref field, so Conduit manufactures one inside the Conduit-owned body block.

**Marker contract.** A single optional line inside the `<!-- conduit:start --> … <!-- conduit:end -->` block (see [agent-presets.md](./agent-presets.md)):

```
<!-- conduit:base=branch-2 -->
```

It's free text in an HTML comment — no label namespace, no per-branch label proliferation, and branch names containing `/` or `.` (`release/2.0`) work verbatim.

- **Read path.** The resolver parses the marker from `TriggerEvent.issue.body` (already propagated on webhook and polling paths) and uses it as the base. If the marker names a branch that **doesn't exist on the remote**, the run hard-fails with a clear `WorkspaceError` rather than silently substituting a base — a typo'd or stale base surfaces loudly. Absent marker → repo default, unchanged.
- **Read-once.** The marker is consulted only at **branch birth**. Once the branch exists, the resolver tracks it and `baseRef` is fixed by first-create-wins — a changed marker on an existing branch is inert. Same stability guarantee the slug has.
- **Write path.** Conduit can't inject the marker mechanically — issues are created by the agent through the GitHub MCP `create_issue` tool, opaque to the orchestrator. So the marker is **preset-driven**: the `publish` preset stamps it when operating on a non-default base branch.

Deferred: per-phase base branches (contradicts the one-branch-per-ticket loop), re-reading the marker after birth, and validating the marked branch is a "safe" base (only remote existence is gated).

Validation at save time: every trigger must surface an issue or PR identifier (rejected webhook events: `push`, `release`, `workflow_run`, `board.column.changed`); polling triggers always pull issue identity from the GraphQL response and pass unconditionally.

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

*PR creation*: Conduit does not auto-open a PR. The agent's instructions are expected to handle this on first push (e.g., "if no PR exists for this branch, open a draft PR"). The shipped `develop` template's QA agent includes this pattern.

**Delete**: **not automatic in v1.** Branches persist until manually deleted. Branches are cheap; auto-janitors that watch PR merge + ticket close + cooling-off add a whole subsystem for modest ergonomic gain. Revisit in a later phase.

## Concurrency

**Concurrent triggers on the same ticket (same workflow)**: one active run per `(workflow, ticket)` at a time, enforced via the deterministic Temporal workflow ID — the mechanism (`run-<workflowId>-<ticketId>`, `WorkflowExecutionAlreadyStarted` drop, `ALLOW_DUPLICATE` reuse that keeps board cycles firing) is owned by [agent-execution.md](./agent-execution.md#per-ticket-concurrency). Applies to every v1 workflow — every entry node is `ticket-branch`. The branch-specific reason it matters: concurrent runs would otherwise race on `git worktree add` and `git push` against the same `conduit/*` branch.

**Base-clone race on the same host**: two activities (different tickets, same repo) might call `git worktree add` against the shared base clone at the same moment. A local file lock on the base-clone path serializes these. Local-process only, not distributed.

**Push conflicts**: if a retry-scenario causes two push attempts with different parents, git rejects the non-fast-forward push naturally. Conduit never force-pushes. The retried activity picks up the current remote state on its next worktree resolve.

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

The cross-cutting deferrals — `conduit/*` auto-delete, auto-rebase on `main` drift, queued-run dedup / webhook-storm backpressure, and a save-time designated pusher — are tracked in [PLANS.md](../PLANS.md#phase-8--later). Branch-specific ones not listed there:

- Branch-protection automation on `conduit/*` (opt-in, needs admin scope on the platform token).
- Ticket-only platforms (Jira, Linear) where tickets and branches live on different hosts — requires a second connection on the workspace spec and a weaker Critic loop via flat comments.
- `TicketBranch` row cleanup — rows accumulate monotonically in v1 (one per ticket ever touched). Rows are small and bounded by per-repo ticket volume; auto-cleanup lands alongside branch auto-deletion.

## Not features

Stances, not roadmap items: no Conduit-owned cross-run blob store (DB blobs or extended `.conduit/` persistence); no cycle edges or loop nodes in the graph; no runtime-owned push step (agents push via git themselves); no mandatory human push protection on `conduit/*` (convention only).
