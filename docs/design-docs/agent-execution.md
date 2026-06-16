# Agent Execution

Covers: Temporal workflow, agent activity, provider abstraction, workspaces, MCP server lifecycle, streaming.

## Temporal workflow

One workflow: `agentWorkflow(input: { workflowId, runId, triggerEvent })`.

Responsibilities:
1. Load node graph (via `loadGraphActivity`).
2. Topologically sort into parallel groups.
3. For each group in order, run all nodes concurrently via `Promise.all`.
4. Each node → `runAgentNode` activity.
5. After parallel group completes: **sequentially** merge each agent's worktree back via `mergeWorktreeActivity` (one at a time, so each merge sees the previous one's result).
6. Copy `.conduit/` files from parallel worktrees into the target workspace (`.conduit/` is gitignored, so this is a file copy, not git).
7. Mark run complete, delete `.conduit/` folder.

Constraints (V8 sandbox):
- No Node.js imports in the workflow file.
- Topo sort inline (small helper copied into the workflow file).
- All I/O — Prisma, Redis, git, agent providers, MCP servers — lives in activities.

Failure handling: per-activity retry policy. Workflow-level `try/catch` marks run `FAILED` and records which node exploded. See [RELIABILITY.md](../RELIABILITY.md).

## Activities

| Activity | Responsibility |
|---|---|
| `loadGraphActivity(workflowId)` | Read workflow + nodes + edges from Postgres, return plain object |
| `runAgentNode(node, context)` | **Orchestrator only.** Resolves workspace + MCP configs, packs a `RunnerRequest`, spawns an `agent-runner` (container or host process, by runner mode), and translates the returned `RunnerEvent` stream into Prisma + Redis + heartbeat writes. The provider SDK runs inside the runner, not here. See [Runner container model](#runner-container-model). |
| `mergeWorktreeActivity(node, targetBranch)` | `git merge --squash` of a parallel agent's worktree back into the target branch — no LLM. On conflict it aborts with `MergeConflictError`; the conflict-resolution agent session is deferred (see [Merge-back agent](#merge-back-agent) below / PLANS Phase 8+). |
| `copyConduitFilesActivity(group)` | Copy `.conduit/` files from each parallel worktree into the target workspace after merge |
| `cleanupRunActivity(runId)` | Best-effort cleanup after run ends — deletes workspace tmpdirs, prunes git worktrees, deletes `.conduit/` folder. `ticket-branch` workspaces have extra semantics; see [Cleanup for `ticket-branch` workspaces](#cleanup-for-ticket-branch-workspaces) below. |
| `pollBoardActivity(input)` | One poll cycle for a polling-mode workflow. Queries GitHub Projects v2, filters, set-diffs against `PollSnapshot`, starts `agentWorkflow`s for new matches, upserts the snapshot. See [Polling pipeline](#polling-pipeline) below. |

Activities use Temporal **heartbeats** so long-running agent sessions don't get killed for inactivity. Heartbeat payload carries current tool call + token count — doubles as the live update stream.

## `runAgentNode` lifecycle

The activity is now an **orchestrator** — it never imports a provider SDK. All LLM and tool I/O happens inside a per-run `agent-runner` container; see [Runner container model](#runner-container-model) for the protocol.

```
1. Build AgentContext from triggerEvent (slim: { trigger, workflow, run })
2. Resolve workspace (derived from graph topology by `deriveWorkspaces`):
     - inherit        → branch worktree from upstream's HEAD (or reuse if sequential).
                        Push env + credential helper carry through from the `ticket-branch` ancestor — any agent in the chain can `git push`.
     - ticket-branch  → entry kind. Two arms dispatched by trigger event:
                        - Issue trigger: derive `conduit/<ticket-id>-<slug>` (slug stored in `TicketBranch` row at first creation).
                          - if remote branch exists: `git worktree add <tmpdir> conduit/<ticket-id>-<slug>` off the base clone.
                          - if not: `git worktree add -b conduit/<ticket-id>-<slug> <tmpdir> <baseRef>`.
                        - PR trigger: `git worktree add <tmpdir> <pr.headRef>` after fetch. No row created.
                        Check-then-create is serialized by a local file lock on the base clone (handles retry and cross-workflow races on the same host).
                        Connection is read from the workflow's single trigger configuration. Inject platform token into agent process env and configure a git credential helper reading from env — token never written to `.git/config` or remote URL. See [SECURITY.md](../SECURITY.md).
                        Must be idempotent under Temporal activity retries.
3. Install selected `node.skills` into the workspace (`.claude/skills/<id>/SKILL.md`
   or `.agents/skills/<id>/SKILL.md`); the runner's SDK discovers them from the filesystem.
4. Resolve MCP configs orchestrator-side: decrypt + substitute `{{credential}}`
   in env/headers (placeholders never reach the runner), and auto-attach a
   synthetic writeback MCP — GitHub or GitLab, matching the firing trigger's
   platform — if the agent has `issueWriteback` but no MCP of its own for that
   platform (see [Issue writeback](#issue-writeback)).
5. Pre-render the three turn prompts: `main` (serialized AgentContext),
   optional `issueWriteback`, `summary` (writes `.conduit/<NodeName>.md`).
6. Spawn the runner via `resolveRunnerSpawner().spawn(req, signal)` and forward
   each `RunnerEvent` into the existing onAgentEvent / system-log / heartbeat
   paths until a terminal `exit` arrives.
7. On `exit ok=true` persist NodeRun COMPLETED with output (files, head,
   workspaceKind, branchName) and the runner-returned `.conduit/<NodeName>.md`.
   On `exit ok=false` or missing terminal event, throw — Temporal flips to FAILED.
8. On cancel: the abort signal flows through `RunnerHandle.cancel()` — `docker kill`
   in docker mode, a process-group SIGTERM→SIGKILL in host mode — the runner is
   reaped, and the activity returns CANCELLED.
```

## Provider abstraction

Lives in `@conduit/agent`. Minimal interface:

```ts
interface AgentProvider {
  readonly id: 'claude' | 'codex';
  getCapabilities(): ProviderCapabilities;         // models, max tokens, MCP support
  startSession(req: AgentRequest, signal: AbortSignal): AgentSession;
}

interface AgentSession {
  // One turn. Yields events until the provider emits `done`. Reusing the
  // same session across runs keeps conversation state (Claude: streaming-
  // input `query()`; Codex: persistent `Thread`), so the final-summary turn
  // sees everything the main turn did.
  run(userMessage: string): AsyncIterable<AgentEvent>;
  dispose(): Promise<void> | void;
}

type AgentRequest = {
  model: string;
  systemPrompt: string;              // agent node's instructions — delivered as the SDK system prompt
  mcpServers: ResolvedMcpServer[];   // configs with credentials substituted; SDK spawns/manages them
  workspacePath: string;             // always present — workspace is required
  webSearch: boolean;                // gates the provider's built-in web search/fetch (off by default)
  constraints: AgentConstraints;
};

type AgentEvent =
  | { type: 'text';        delta: string }
  | { type: 'tool_call';   id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; error?: string }
  | { type: 'usage';       inputTokens: number; outputTokens: number }
  | { type: 'done' };
```

### Providers (v1)

- **`ClaudeProvider`** wraps `@anthropic-ai/claude-agent-sdk`. MCP configs are passed directly — the SDK spawns/manages them natively. Built-in tools (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`) are enabled with CWD set to the workspace path.
- **`CodexProvider`** wraps `@openai/codex-sdk`. Same shape. Codex SDK has its own built-in filesystem tools and MCP support.

Both providers are **dumb adapters** — they translate `AgentRequest`/`AgentEvent` to/from the SDK. No retry logic (Temporal handles it), no MCP lifecycle (SDK handles it), no credential decryption (done upstream before the config reaches the SDK).

### Web search

`webSearch` on `AgentRequest` is a per-agent boolean — off by default — that toggles the provider's built-in web tooling. It is *not* exposed as an MCP server; both SDKs have native support and Conduit just routes the flag.

| Provider | Off | On |
|---|---|---|
| Claude | `disallowedTools: ['WebSearch', 'WebFetch']` strips them from the `claude_code` preset | `disallowedTools: undefined` — `WebSearch` / `WebFetch` are exposed |
| Codex | `webSearchMode: 'disabled'` on `startThread` | `webSearchMode: 'cached'` — reuses prior search results to avoid per-fetch cost; promote to `'live'` only if a workflow needs fresh hits |
| Stub | ignored | ignored |

Codex emits `web_search` items with no `status` field; the provider adapter translates `item.started` → `tool_call` (carrying the query) and `item.completed` → `tool_result`, so searches show up in the run timeline alongside other tool calls.

## Runner container model

Provider SDKs and MCP servers run inside a dedicated `agent-runner` process — never on the worker process. In **docker mode** that's one short-lived `docker run --rm` per agent node; in **host mode** ([below](#host-mode-local-deployments)) it's a detached child process on the worker's machine. The orchestrator/runner split is identical either way:

| Worker process (orchestrator) | Runner container (agent-runner) |
|---|---|
| Postgres, Redis, master KEK, all credentials | Provider SDKs, pre-resolved MCP configs, system toolchain |
| Workspace + MCP resolution, prompt rendering, RunnerEvent translation | Provider session, three turns (main / writeback / summary), `.conduit/<NodeName>.md` placeholder, post-run `git status` |
| Idempotent under Temporal retries | One process per run; on retry the worker spawns a fresh container |

The orchestrator activity calls `resolveRunnerSpawner().spawn(req, signal)`. Two spawners sit behind the `RunnerSpawner` seam — `LocalDockerSpawner` and `LocalProcessSpawner` — picked by **runner mode**, resolved once at worker boot from `CONDUIT_DEPLOYMENT` × `CONDUIT_RUNNER_MODE` (`apps/worker/src/runtime/runner/mode.ts`):

| `CONDUIT_DEPLOYMENT` | `CONDUIT_RUNNER_MODE` | Result |
|---|---|---|
| `local` (default) | unset | **host** |
| `local` | `docker` | docker |
| `hosted` | unset or `docker` | docker |
| `hosted` | `host` | **boot failure** — worker refuses to start |
| any | anything else | boot failure (invalid value) |

`hosted`+`host` fails loudly rather than silently downgrading — same posture as `CONDUIT_AGENT_AUTH=oauth-mount`: trust-boundary relaxation is explicit, logged, and impossible when hosted. The wire protocol is identical in both modes (`apps/agent-runner/src/main.ts` runs byte-identical; only the spawn primitive differs), and the same seam is where future phases (k8s Job, runner pool) plug in without touching the activity above.

**Wire protocol** lives in `@conduit/shared/runner` (Zod-validated on both ends): the orchestrator writes one `RunnerRequest` to stdin, the runner streams `RunnerEvent` lines back. Three non-obvious bits:

- The orchestrator stops reading after the first `exit` event and calls `RunnerHandle.cancel()` so `docker kill` reaps the container before the activity returns.
- If the runner dies without emitting `exit`, or stdout goes silent past the liveness threshold (default 60s), the spawner synthesizes an `exit ok=false` carrying a tail of stderr — so the failure surfaces in the run timeline instead of a bare exit code.
- `heartbeat` events are independent of agent flow, so a slow tool call doesn't look like a dead runner.

**Container invariants** (docker mode) — enforced by `LocalDockerSpawner`, not user-configurable:

- **Same-path bind mounts.** Run dir mounted at its host absolute path, so `.git` worktree pointer files resolve identically. The bare clone backing this workspace is mounted similarly when applicable; **only that one bare clone**, never the whole `~/.conduit/base-clones/` tree.
- **Non-root UID/GID** equal to the host worker's.
- **Default bridge networking** — no `--privileged`, no `--network=host`, no docker.sock mount.
- **Labels** `conduit.runId=<id>` and `conduit.nodeName=<name>` so `sweepOrphans` (worker boot) can reap containers whose runs are already terminal.

**Authentication** is selected by `CONDUIT_AGENT_AUTH`:

| Mode | What it does | When |
|---|---|---|
| `api-key` *(default)* | Credentials travel only through `RunnerRequest.provider`. No host credential files mounted. | Production / shared environments |
| `oauth-mount` | Additionally bind-mounts **only** the host's `~/.codex/auth.json` at `/home/runner/.codex/auth.json` inside the container (Codex has no `setup-token` flow yet). Worker logs a boot warning. A compromised agent can read or rewrite the host file. | Local dev only |

Claude OAuth uses `CLAUDE_CODE_OAUTH_TOKEN` forwarded through the protocol — no mount needed, regardless of mode. In host mode `oauth-mount` is a no-op (logged at boot): the runner sees the real `$HOME`, so `~/.codex/auth.json` is reachable without any mount.

### Host mode (local deployments)

The Docker image can never replicate a user's dev environment — Xcode and iOS simulators, the Android SDK, signing certs, `~/.gitconfig`, host toolchains. So local deployments default to running the runner directly on the host. The trust model is "agent acting as the user on their machine", the same thing running Claude Code or Codex CLI directly grants; host mode is **explicitly unsandboxed** and the worker says so in a boot banner. Mechanics (`apps/worker/src/runtime/runner/local-process.ts`):

- **Detached process group.** The runner entry point (resolved through the `@conduit/agent-runner` workspace dependency) spawns as a detached child leading its own process group. Cancellation signals the whole group — SIGTERM, then SIGKILL after a grace period — so MCP-server grandchildren die with the runner, and `cancel()` resolves only once the group is gone.
- **Env denylist instead of explicit forwarding.** Docker forwards only explicit `-e` vars; a host child inherits everything. The spawner strips Conduit-internal secrets (DB/Redis URLs, the master encryption key, auth/webhook/GitHub secrets, provider API keys) before spawning, so "the runner never sees Conduit credentials" still holds. Provider creds travel via `RunnerRequest.provider`, same as docker mode; the user's toolchain env (`PATH`, `ANDROID_HOME`, `JAVA_HOME`, …) works by construction.
- **Pidfile sweep instead of container labels.** Each spawn writes `<runDir>/runner-<nodeName>.pid` (per node, mirroring docker mode's per-node container names) stamping the pid and its `ps` start time; worker boot kills process groups whose run is already terminal or unknown (`process-admin.ts`, the host counterpart of `docker-admin.ts`'s label-based `sweepOrphans`), verifying the start time first so a recycled pid is never signalled, and skipping the sweep entirely when the DB is unreachable. Both orphan sweeps run at every boot regardless of the current mode — orphans belong to whichever mode the previous session ran in. `dockerPreflight` is skipped — Docker need not be installed at all — and is replaced by a boot-time check that the `@conduit/agent-runner` entry point is built.
- **No mounts, no UID mapping, no HOME override.** The same-path bind-mount machinery in docker mode exists only to make the container look like the host; on the host it holds trivially.

E2e pins `CONDUIT_RUNNER_MODE=docker` (`test/e2e/harness.ts`) so the suite keeps exercising the real image. Per-node mode mixing (`runtime: host|docker` on individual agents) and host-side sandboxing are out of scope for now; the spawner seam supports them later.

## Workspace manager

Lives in `@conduit/agent/workspace`. Responsibilities:

- **Base clones** cached under `~/.conduit/base-clones/<host>/<owner>/<repo>.git` (bare clone, fetched on first use, periodically refreshed).
- **Seed a worktree** for a run: `git worktree add <tmpdir> <ref>` off the base clone. Fast — no network for repeat runs.
- **Branch a worktree** for `inherit` + parallel fan-out: `git worktree add <tmpdir> HEAD` off the upstream's worktree, creating a throwaway branch.
- **Resolve a `ticket-branch` worktree**: check the remote for `conduit/<ticket-id>-<slug>`, add worktree from it (or create with `-b <baseRef>` on first run). Check-then-create guarded by a local file lock on the base clone.
- **Strip auth from remote URLs** after seeding — prevents tokens leaking into agent-visible `.git/config`. For `ticket-branch`, push auth is provided via env var + credential helper instead; see [SECURITY.md](../SECURITY.md).
- **Cleanup** on activity finish (tmpdir rm + `git worktree prune`). `ticket-branch` remote branches are preserved; only the local worktree is cleaned.

Credentials for cloning come from the referenced `Connection` (resolved via `loadConnectionContext`, which requires `scope.kind === 'github_repo'`), not from MCP servers — the workspace manager clones *before* the agent runs. See [connections.md](./connections.md).

## MCP servers

See [mcp-servers.md](./mcp-servers.md) for full details.

Key points:
- **SDK-managed.** Both Claude Agent SDK and Codex SDK handle MCP lifecycle natively — spawn, connect, invoke, teardown. Conduit only builds the config.
- Conduit's role: decrypt credentials, substitute `{{credential}}` in env/headers, hand the config to the SDK.
- Servers are **per-agent-node** — the SDK creates fresh instances for each agent.
- Credentials never land in logs or Temporal history — substitution happens in-memory just before the SDK call.

## Parallel execution & merge-back

When a topo-sort group contains multiple nodes, they run concurrently on branched worktrees. After all agents in the group complete:

1. **Sequential merge-back**: the runtime runs `mergeWorktreeActivity` for each agent **one at a time** as separate Temporal activities, in **node-definition order** (the order agents appear in `definition.nodes`). Each merge sees the result of the previous one, so conflicts are resolved incrementally. Deterministic ordering guarantees reproducibility across re-runs.
2. **`.conduit/` file copy**: since `.conduit/` is gitignored, it's not part of the git merge. The runtime copies each agent's `.conduit/<NodeName>.md` from its worktree into the target workspace — simple file copy.
3. Downstream agents then see the merged code + all upstream `.conduit/` summaries in the workspace.

This keeps parallel execution fast (agents work concurrently) while making merge deterministic (sequential, one at a time).

## Merge-back agent

### What ships in Phase 3

`mergeWorktreeActivity` is a `git merge --squash` from the parallel sibling's HEAD into the upstream worktree — source's per-commit history never enters target, and `.conduit/` is scrubbed before commit so neither target's tip nor target's history carries any `.conduit/` paths the agent committed during its session.

Source side (`apps/worker/src/activities/merge-worktree.ts`):

1. `git add -A` in the sibling worktree, then commit any staged changes as `Conduit: <sourceNodeName> snapshot`. `add -A` silently honors the source repo's `.gitignore` — usually excluding `.conduit/`. If the repo doesn't gitignore it, the snapshot briefly carries `.conduit/`; the target-side strip handles that.
2. If the sibling HEAD equals the target HEAD, the activity returns (nothing to merge).

Target side (`packages/agent/src/workspace/merge.ts`):

3. **Snapshot then clear target's `.conduit/`.** Read the basenames target had under `.conduit/` (e.g. the upstream summary copied in by `cloneConduitFolder`) into `existedBefore`, then `clearConduitFolder` so the squash doesn't trip git's untracked-overwrite preflight when source's snapshot writes to the same paths.
4. `git merge --squash <sourceRef>`.
5. List `.conduit/*` paths the squash staged, `git rm --cached --ignore-unmatch -- .conduit` to drop them from the index, then `fs.rm` each on the working tree — **except** any whose basename was in `existedBefore`. Those are target's own and downstream nodes still need them on the WT.
6. If the index is empty after scrubbing (the only diff was `.conduit/`), return without committing — target's HEAD doesn't churn for runtime-only state. Otherwise commit `Conduit: merge <sourceNodeName>`.
7. On `GitError` from the squash: collect conflicted files via `git diff --name-only --diff-filter=U`, then `git reset --hard HEAD` (since `--squash` leaves no `MERGE_HEAD`, `git merge --abort` doesn't apply). Throw `MergeConflictError` carrying the file list — it's in the workflow's `nonRetryableErrorTypes` so the run fails cleanly instead of spinning on retries.

No LLM is involved. In practice parallel agents typically touch different files, so most merges are clean; the conflict path is the exception and aborts the run today.

### Deferred: conflict-resolution agent session

The original design called for `mergeWorktreeActivity` to be a lightweight agent session — short-lived, workspace-tools only, hardcoded system prompt ("merge branch X into Y, resolve conflicts sensibly, commit") — so conflicts could be resolved inline instead of aborting. That session is not implemented yet; `MergeConflictError` is shaped (it carries `conflicts: string[]` and the source ref) so a future handler can pick it up and drive the resolution. Tracked under "later" in [PLANS.md](../PLANS.md).

## Issue writeback

Optional per-agent capability: at end of run, the agent sets a project Status, applies repo labels, and/or sets a pull request's state — on the issue *or* PR the run is about. PR state spans two orthogonal sub-axes: **open/closed** (whether the PR is active) and **draft/ready** (whether it's marked ready for review); the PR-review template uses the latter to mark a draft ready when its review is clean. Works for both GitHub and GitLab triggers, dispatched on the firing event's platform. **GitLab is labels-only**: GitLab v1 has no Projects-v2 Status and no MR-state writeback (boards/MR-state are out of scope), so on GitLab the Status and PR-state allowlists are inert and only the label directives apply. The UI labels this **Issue / PR writeback**; the field stays `AgentConfig.issueWriteback` (`packages/shared/src/agent/issue-writeback.ts`) so no migration was needed. Its mere presence is the "feature is on" signal. All three allowlists may be empty; an empty allowlist is treated as enabled-but-unselected and the runtime skips the writeback turn entirely.

`allowedStatuses` / `allowedLabels` / `allowedPrStates` are what the agent may *set*. Labels carry over to PRs unchanged (GitHub treats PRs as issues for labels), and a project Status applies only when a board is bound. `allowedPrStates` (`'open'` / `'closed'` / `'draft'` / `'ready'`) is a repo-native axis that needs no project board and is meaningful only on PR-triggered runs. Its values cover two *orthogonal* sub-axes — open/closed and draft/ready — that share one array; `issueWritebackPrompt` partitions them into separate directives so the agent never reads them as one mutually-exclusive list. Merging is deliberately excluded. The label the run was *gated on* — the trigger's `label` filter — is removed automatically, so a board-pipeline handoff (e.g. `conduit-dev` → `conduit-review`) is a remove-the-consumed-label, add-the-next-one swap that the template never has to describe. The removal target isn't authored anywhere; it's derived from the trigger that fired.

The turn has two shapes, picked by whether the run has a triggering issue:

- **Issue- or PR-anchored** — the run was fired by a GitHub issue *or* PR event, or a GitLab issue event (polling / webhook); the agent updates that one issue or PR. GitHub PR-shaped runs (`triggerEvent.pr` present) share the issue number space, so the anchor is the same `owner/repo#N` — only the wording and the open/closed directive change (see [Run-time](#run-time)). GitLab MR-triggered runs are intentionally *not* MR-anchored — writeback stays issue-scoped on GitLab (MR-label writeback is out of scope), so an MR run lands in the repo-scoped shape below.
- **Repo-scoped** — the run targets a GitHub or GitLab repo but no specific issue (a cron run, or a GitLab MR run; cron carries `repo` resolved from the trigger connection but no `issue`). The agent constrains the Status / labels it sets on whatever issues it creates or touches during the run — the nightly-review Publisher creating one issue per finding is the motivating case.

### Config-time

The agent panel's **Issue / PR writeback** field renders a checkbox plus pill-toggle groups (`AgentConfigPanel.IssueWritebackControl` in `apps/web/src/components/canvas/AgentConfigPanel.tsx`); which status axis shows depends on the trigger type:

- **Allowed statuses** (issue / cron triggers) — the trigger's project board's `Status` single-select options, fetched via `useListProjectBoards` (already used by the trigger panel).
- **Allowed PR states** (`pull_requests` triggers) — a fixed Open / Closed / Draft / Ready pill group, shown *instead of* board statuses since PR triggers never bind a project board.
- **Allowed labels** (any GitHub trigger) — the trigger connection's repo labels, fetched via `useListLabels` → `POST /api/workflows/:id/trigger/list-labels` → `listRepoLabels` (`packages/shared/src/platform/github/labels.ts`).

The field is hidden behind a hint when the workflow has no GitHub trigger. Picking nothing is allowed at save time, but explicit copy warns the user that the runtime will skip the turn. The status / PR-state pickers are not yet platform-gated for GitLab triggers (deferred — see the `frontend-platform-instance-ux` sub-feature); until then a GitLab config may show an inert status picker whose values the GitLab prompt branch ignores. No incorrect behavior, just an unfiltered picker.

### Run-time

Between the main turn and the summary turn, `runAgentNode` injects a third turn driven by `issueWritebackPrompt` (`packages/agent/src/context.ts`). The prompt interpolates the allowlist values verbatim — *only what the user picked appears* — so the choice set is encoded entirely in the prompt wording. There is no schema-level enforcement and no post-run validation; the agent is trusted to pick one of the listed values, or skip if none fit. Prompt construction is per-list — if only statuses (or only labels) are allowlisted, no phantom second list shows up in the directive. `consumedLabels` (the trigger's `label` filters, minus any the agent is also told to apply) add a *remove* directive, so a status-gated entry point like Analyze removes nothing while a label-gated stage removes the label that fired it. When the run is PR-shaped (the context's `isPr` flag), the prompt switches to pull-request wording — anchor `PR: owner/repo#N`, plus up to two `allowedPrStates` directives (open/closed and draft/ready, partitioned so neither leaks into the other) — telling the agent to read and update the PR through the attached GitHub MCP tools (PR labels live on the shared issue number, so the issue-label tools apply; open/closed and draft/ready are pull-request fields, the latter set via the MCP's PR-update `draft` flag). Board-Status lines never appear for PRs because the trigger offers no statuses. All writeback — issue or PR — goes through the auto-attached MCP server, never a `gh`/`glab` CLI: the runner image ships those binaries but never authenticates them (the connection token reaches the runner only as the MCP bearer header and a `git push` credential helper), so CLI wording sent PR runs to an unauthenticated tool and they couldn't read or write labels.

The prompt takes a `platform` argument and branches on it. The **GitHub** branch keeps the full directive set — Status (board-bound runs), PR open/closed and draft/ready (`isPr` runs), and labels. The **GitLab** branch is labels-only: it drops the Status and PR-state lines entirely (inert on GitLab v1), keeping the label-apply / consumed-label-removal / leave-everything-else-untouched directives and the issue- vs repo-scoped header. `isPr` never flips GitLab to PR wording, since MR-state writeback is out of scope. Both branches route the agent through their auto-attached MCP server (`GitHub (writeback)` / `GitLab (writeback)`) — neither uses a CLI, for the unauthenticated-binary reason above.

`resolveWritebackContext` (`apps/worker/src/activities/writeback.ts`) returns `undefined` (skipping the turn) when:

- the agent has no `issueWriteback` field;
- all of `allowedStatuses`, `allowedLabels`, and `allowedPrStates` are empty;
- the firing source is neither `github` nor `gitlab` (e.g. `jira` — no writeback MCP), or no trigger matches the firing platform;
- `triggerEvent.repo` is missing (manual runs).

The resolved context carries a `platform` (`'github' | 'gitlab'`, the firing event's source) that the call site uses to pick the preset and prompt branch. A run only needs a GitHub/GitLab **repo** to qualify — not a triggering issue. `triggerEvent.issue` is optional: present ⇒ issue-anchored, absent ⇒ repo-scoped. `triggerEvent.pr` presence sets the context's `isPr` flag, which is what flips the (GitHub) prompt to PR wording.

### Synthetic writeback MCP auto-attach

The agent needs the firing platform's MCP to actually call the writeback. `runAgentNode` checks whether the agent already references that platform's MCP server on the workflow (`agentReferencesWritebackMcp(node, servers, platform)` in `apps/worker/src/activities/writeback.ts`). The check matches by transport fingerprint, not id, against the preset resolved by `findMcpPresetByPlatform(platform)` so a rename doesn't break it — and it covers both transport kinds a preset can take: the **GitHub preset is a remote `streamable-http` server, matched by same `url`**, while the **GitLab preset (`@zereight/mcp-gitlab`) is `stdio`, matched by shared package args** (this also catches a user's own stdio GitHub MCP). The match is platform-scoped, so a GitHub MCP never suppresses GitLab auto-attach and vice versa. If no matching MCP is referenced, it builds a synthetic `WorkflowMcpServer` — id from `writebackMcpId(platform)` (`__conduit_writeback_github__` / `__conduit_writeback_gitlab__`), preset transport, bound to the firing trigger's connection — and appends it to both `effectiveNode.mcpServers` and `effectiveMcpServers` for this activity invocation only; nothing is persisted to the workflow definition.

**Self-hosted GitLab host.** The GitLab preset ships the `gitlab.com` API URL. For self-hosted instances the API base varies, so when the platform is GitLab the call site resolves the connection's normalized host via `loadConnectionHost` (`apps/worker/src/runtime/connection-context.ts` — a focused host read that skips the token decrypt `loadConnectionContext` does) and overrides the preset's `GITLAB_API_URL` with `gitlabApiUrl(host)` (`https://<host>/api/v4`, port preserved). `gitlab.com` normalizes to the default URL, so the override is a no-op there. The `GITLAB_PERSONAL_ACCESS_TOKEN: {{credential}}` placeholder is preserved and resolves through the same credential lookup as any other MCP secret. GitHub takes no host — its preset URL (`api.githubcopilot.com`) is cloud-only, so GitHub Enterprise Server writeback stays out of scope until that MCP path becomes host-aware.

When the user *has* added a matching MCP, that one wins regardless of which connection it uses. No double-attach.

Trust surface: the auto-attached server inherits the same trigger token the rest of the workflow uses, so the writeback never asks for an extra PAT. The token lifetime is the activity, same as any other resolved MCP server. Writeback failures (bad scope, GitHub/GitLab 4xx) surface as agent-visible tool errors, not workflow failures — the run still completes.

## Streaming & live updates

Every `AgentEvent` produced by the provider is wrapped by the runner as `{ kind: 'agent', event }` and written to stdout. The orchestrator activity reads each line and:
1. Appends it to `ExecutionLog` (Postgres) for durability.
2. Publishes to Redis `conduit:run-updates` channel with `{ runId, nodeName, event }`.
3. Triggers a Temporal heartbeat with a compact summary (current tool + token count). The heartbeat runs on its own 30s interval driven by the orchestrator and by the runner's `heartbeat` event, so a slow tool call never trips Temporal's liveness check.

Frontend flow:
- `RunsGateway` (NestJS) subscribes to Redis, re-emits on Socket.IO `runs/<runId>` room.
- `useRunUpdates(runId)` hook in web merges events into TanStack Query cache.
- Run detail page subscribes per-node and renders live text, active tool, and counters in the main-area timeline tab.

## Cancellation

- User clicks "Cancel run" → API sends Temporal `cancelWorkflow`.
- Workflow cancellation propagates to in-flight activities.
- Activity's `CancelledFailure` handler triggers the orchestrator's `AbortController`.
- The abort signal flows to `RunnerHandle.cancel()` — `docker kill <containerName>` in docker mode, a process-group SIGTERM (escalating to SIGKILL after a grace period) in host mode. The runner process exits; the provider SDK tears down its MCP servers on the way out. Workspace manager runs cleanup in `finally` on the orchestrator side.
- Both paths are idempotent — safe to call after the runner has already exited on its own — and resolve only after the runner is fully reaped (container removed / process group gone), so the orchestrator can sequence cleanup and the next run with the same name doesn't race.

## Per-ticket concurrency

One active run per `(workflow, ticket)` at a time, enforced at the Temporal boundary by the deterministic workflow ID `run-<workflowId>-<ticketId>` (`WorkflowIdConflictPolicy = FAIL` drops the duplicate, `WorkflowIdReusePolicy = ALLOW_DUPLICATE` lets the ID re-fire after termination so board cycles keep working). The base-clone file lock from lifecycle step 2 covers the separate, smaller window where two *different* workflows/tickets race on `git worktree add` against the same shared base clone.

Ownership angle (why `conduit/*` is one-run-at-a-time): [branch-management.md](./branch-management.md#concurrency). Drop/return-200 failure-mode detail: [RELIABILITY.md](../RELIABILITY.md#failure-modes-and-responses).

## Cleanup for `ticket-branch` workspaces

`cleanupRunActivity` runs at end-of-workflow for all workspace kinds. `ticket-branch` differs in two ways — it preserves the remote branch (only the local worktree is pruned, since the branch is iteration N+1's persistent state) and emits a non-blocking unpushed-commits warning to `ExecutionLog`. Both are owned elsewhere: see the "Footgun" + Lifecycle sections of [branch-management.md](./branch-management.md#lifecycle) for the local-only (no-`git fetch`) push check and remote-branch preservation, and [RELIABILITY.md](../RELIABILITY.md#workspace-cleanup) for the cleanup layering.

## Constraints enforcement

`AgentConstraints` (max turns, tokens, tool calls, timeout) are enforced **inside the provider adapter** — it counts events and throws `ConstraintExceededError` when breached. Timeout is a Temporal activity-level `startToCloseTimeout` *and* a provider-level wall-clock guard (belt + suspenders).

## Polling pipeline

Polling triggers run on a separate Temporal workflow type (`pollWorkflow`) driven by a Temporal **Schedule**, one per Conduit workflow. Independent of `agentWorkflow` — the poller decides *whether* to start a run; `agentWorkflow` is the run itself.

Lifecycle:

1. **Schedule registration.** On workflow save, the API's `TemporalService.upsertPollSchedule` is called with `{ workflowId, intervalSec, active }`. It creates (or updates) a Schedule at the deterministic id `pollScheduleId(workflowId)` with:
   - `spec.intervals = [{ every: '<intervalSec>s' }]`
   - `action.type = 'startWorkflow'`, `workflowType = 'pollWorkflow'`, `workflowId = pollWorkflowId(workflowId)`
   - `policies.overlap = SKIP` — a slow poll cycle never piles up behind its successor.
   - `state.paused = !workflow.isActive`.
   Webhook-mode or non-existent triggers have their schedule deleted. Delete is idempotent (`NOT_FOUND` is swallowed).
2. **Boot reconcile.** `WorkflowsService.onModuleInit` walks every polling workflow in the DB and calls `upsertPollSchedule` so a Temporal outage at boot doesn't leave schedules out of sync — any subsequent API restart re-asserts the state.
3. **Tick.** The Schedule fires `pollWorkflow(workflowId)` — a sandboxed shell that just calls `pollBoardActivity`.
4. **Poll cycle (`pollBoardActivity`).** The query dispatch (board issues / repo issues / repo PRs by `type` + `boardConnectionId`, set-diff against `PollSnapshot`, start `agentWorkflow`s for new matches) is summarized in [ARCHITECTURE.md](../ARCHITECTURE.md#data-flow-webhook--live-ui). The activity-specific mechanics:
   - Re-read the workflow + trigger config from Postgres (schedule definitions carry only the workflow id, so config edits take effect on the next tick).
   - All query paths return the same `ProjectBoardItem` shape so filter/dedup/event-build is source-agnostic. Repo-source items have empty `singleSelectValues` (no Status column).
   - Apply the trigger's filters against a small `FilterView` built from the polled item: `status` (from `singleSelectValues.Status`), `labels` (from the issue/PR's labels, fetched in the same GraphQL query), and `prState` (from the PR's draft flag, only set when the item is a PR). The webhook flattener builds the same shape from the inbound payload, so one filter set works in either mode.
   - Build the `TriggerEvent`: `event === 'board.column.changed'` for issue scope, `event === 'pull_request.detected'` for PR scope. PR scope additionally populates `TriggerEvent.pr` (head/base refs, plus `headRepo` for fork PRs) and writes `payload.prState` so the matcher can flatten it back into the `FilterView`.
   - Diff the matching `itemNodeId` set against `PollSnapshot.matchingIds`. **New → start an `agentWorkflow`**; still-matching items do *not* re-fire. Re-entry (item leaves the matching set, comes back) is treated as new — this is the board-cycle primitive that makes Dev → Review → Dev loops work, and it extends transparently to draft↔ready PR transitions under `pr_state` filters.
   - **Body hydration (GitHub only).** The initial GraphQL queries deliberately omit the issue/PR `body` field to keep metadata-only payloads lightweight. After dedup and `matchesTrigger()` filtering, a single `nodes(ids:)` GraphQL call fetches bodies only for items that will actually start a run (typically 0–2 per tick). `capTriggerBody` (64 KB default, `\n\n[truncated]` suffix) is applied before the body reaches `TriggerEvent.issue.body`. GitLab is unaffected — its REST API doesn't support field selection.
   - Upsert `PollSnapshot` with the current matching set.
5. **Run start from inside an activity.** `pollBoardActivity` starts `agentWorkflow`s directly via a worker-side `@temporalio/client` singleton (`apps/worker/src/runtime/temporal-client.ts`) — separate from the `NativeConnection` used to poll the worker task queue. Each new match gets a fresh `WorkflowRun` row and a per-run workflow id (`run-<runId>`).

Failure handling: one retry per tick (`maximumAttempts: 2`) — if a cycle fails, the next scheduled tick retries from scratch rather than burning retries on a flaky upstream. Run-starts that succeed are committed before the snapshot upsert, so a crash between the two reprocesses those items on the next tick; worst case is a duplicate run, not a missed transition.

The schedule id, poll/cron run ids, and the agent-run id above all carry a frozen, human-readable **slug** prefix (`poll-run-<slug>-<cuid>`) so an operator can read the workflow + source connection off a Temporal row. The slug is cosmetic — the cuid stays the determinism anchor — and the worker only *reads* the value the API froze. See [temporal-id-slug.md](./temporal-id-slug.md).
