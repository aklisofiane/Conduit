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
| `runAgentNode(node, context)` | Create workspace, spin up MCP servers, invoke provider, stream updates, final prompts (`.conduit/` summary + merge-back), tear down MCP |
| `mergeWorktreeActivity(node, targetBranch)` | Spins up a lightweight agent session to merge a parallel agent's worktree back to the target branch — resolves conflicts via LLM if needed. See "Merge-back agent" below. |
| `copyConduitFilesActivity(group)` | Copy `.conduit/` files from each parallel worktree into the target workspace after merge |
| `cleanupRunActivity(runId)` | Best-effort cleanup after run ends — deletes workspace tmpdirs, prunes git worktrees, deletes `.conduit/` folder. `ticket-branch` workspaces have extra semantics; see [Cleanup for `ticket-branch` workspaces](#cleanup-for-ticket-branch-workspaces) below. |

Activities use Temporal **heartbeats** so long-running agent sessions don't get killed for inactivity. Heartbeat payload carries current tool call + token count — doubles as the live update stream.

## `runAgentNode` lifecycle

```
1. Build AgentContext from triggerEvent (slim: { trigger, workflow, run })
2. Resolve workspace:
     - fresh-tmpdir   → mkdtemp
     - repo-clone     → workspaceManager.seed(connection, ref)
     - inherit        → branch worktree from upstream's HEAD (or reuse if sequential).
                        If the upstream chain traces back to a `ticket-branch` ancestor, the push env + credential helper are carried through — any agent in the chain can `git push`.
     - ticket-branch  → derive branch name `conduit/<ticket-id>-<slug>` (slug stored in TicketBranch row at first creation).
                        Check remote:
                          - if exists: `git worktree add <tmpdir> conduit/<ticket-id>-<slug>` off the base clone.
                          - if not:    `git worktree add -b conduit/<ticket-id>-<slug> <tmpdir> <baseRef>`.
                        Check-then-create is serialized by a local file lock on the base clone (handles retry and cross-workflow races on the same host).
                        Inject platform token into agent process env and configure a git credential helper reading from env — token never written to `.git/config` or remote URL. See [SECURITY.md](../SECURITY.md).
                        Must be idempotent under Temporal activity retries.
3. Enable workspace tools:
     - Configure provider's SDK built-in tools (file read/write/edit, shell, glob, grep)
     - Set workspace path as CWD — scopes all file operations to workspace root
     - Both Claude Agent SDK and Codex SDK have native filesystem tools
3b. Copy selected skills into workspace:
     - For each skill in node.skills, copy the skill directory into the workspace
     - Claude: .claude/skills/<skillName>/SKILL.md
     - Codex: .agents/skills/<skillName>/SKILL.md
     - SDK discovers them automatically from the filesystem
4. Resolve MCP server configs:
     - For each server in node.mcpServers, load from workflow definition
     - Decrypt linked WorkflowConnection secrets and substitute `{{credential}}` in env/headers
     - Pass the resolved configs + allowedTools filtering to the provider
     - SDK handles spawning, connecting, tool invocation, and teardown
5. Start a provider session and drive two turns on it:
     a. `session.run(serializeAgentContext(ctx))` — main work. Events stream out: text chunk, tool call start, tool call result, token delta. Each is heartbeated + published to Redis `conduit:run-updates`.
     b. `session.run(finalSummaryPrompt(nodeName))` — reuses the same session so conversation state is retained. The agent writes `.conduit/<NodeName>.md` via its file tools. A placeholder is dropped in by the runtime if the file is missing at the end.
     Dispose the session in a `finally` (closes SDK thread / streaming-input queue).
7. On finish:
     - Capture changed files (git diff vs. workspace base)
     - Return NodeOutput { files?, workspacePath }
8. Always (finally):
     - On error/cancel: abort provider (AbortController), mark NodeRun FAILED/CANCELLED
     - SDK tears down its own MCP servers on abort
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

## Workspace manager

Lives in `@conduit/agent/workspace`. Responsibilities:

- **Base clones** cached under `~/.conduit/base-clones/<host>/<owner>/<repo>.git` (bare clone, fetched on first use, periodically refreshed).
- **Seed a worktree** for a run: `git worktree add <tmpdir> <ref>` off the base clone. Fast — no network for repeat runs.
- **Branch a worktree** for `inherit` + parallel fan-out: `git worktree add <tmpdir> HEAD` off the upstream's worktree, creating a throwaway branch.
- **Resolve a `ticket-branch` worktree**: check the remote for `conduit/<ticket-id>-<slug>`, add worktree from it (or create with `-b <baseRef>` on first run). Check-then-create guarded by a local file lock on the base clone.
- **Strip auth from remote URLs** after seeding — prevents tokens leaking into agent-visible `.git/config`. For `ticket-branch`, push auth is provided via env var + credential helper instead; see [SECURITY.md](../SECURITY.md).
- **Cleanup** on activity finish (tmpdir rm + `git worktree prune`). `ticket-branch` remote branches are preserved; only the local worktree is cleaned.

Credentials for cloning come from the referenced `WorkflowConnection`, not from MCP servers — the workspace manager clones *before* the agent runs.

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

`mergeWorktreeActivity` does a raw `git merge --no-edit --no-ff` in the upstream worktree, targeting the parallel sibling's HEAD:

1. Any uncommitted changes in the sibling's worktree are first staged and folded into a single `Conduit: <Node> changes` commit (`.conduit/` is explicitly unstaged — it's gitignored by design and copied via `copyConduitFilesActivity` instead).
2. If the sibling HEAD equals the target HEAD, the merge is skipped (nothing to do).
3. On clean merge: a merge commit lands in the upstream and the activity returns.
4. On conflict: `git merge --abort` runs, and the activity throws `MergeConflictError` carrying the conflicted file list. `MergeConflictError` is in the workflow's `nonRetryableErrorTypes` so the run fails cleanly instead of spinning on retries.

No LLM is involved. In practice parallel agents typically touch different files, so most merges are clean; the conflict path is the exception and aborts the run today.

### Deferred: conflict-resolution agent session

The original design called for `mergeWorktreeActivity` to be a lightweight agent session — short-lived, workspace-tools only, hardcoded system prompt ("merge branch X into Y, resolve conflicts sensibly, commit") — so conflicts could be resolved inline instead of aborting. That session is not implemented yet; `MergeConflictError` is shaped (it carries `conflicts: string[]` and the source ref) so a future handler can pick it up and drive the resolution. Tracked under "later" in [PLANS.md](../PLANS.md).

## Streaming & live updates

Every `AgentEvent` produced by the provider:
1. Is appended to `ExecutionLog` (Postgres) for durability.
2. Is published to Redis `conduit:run-updates` channel with `{ runId, nodeName, event }`.
3. Triggers a Temporal heartbeat with a compact summary (current tool + token count).

Frontend flow:
- `RunsGateway` (NestJS) subscribes to Redis, re-emits on Socket.IO `runs/<runId>` room.
- `useRunUpdates(runId)` hook in web merges events into TanStack Query cache.
- Run detail page subscribes per-node and renders live text, active tool, and counters in the main-area timeline tab.

## Cancellation

- User clicks "Cancel run" → API sends Temporal `cancelWorkflow`.
- Workflow cancellation propagates to in-flight activities.
- Activity's `CancelledFailure` handler calls `abortController.abort()` on the provider.
- Provider aborts SDK call, flushes partial events, throws.
- SDK tears down its MCP servers on abort. Workspace manager runs cleanup in `finally`.

## Per-ticket concurrency

For workflows with a `ticket-branch` workspace, concurrent runs on the same ticket would race on `git worktree add` and push. Intent: one active run per `(workflow, ticket)` at a time; duplicate triggers during that run are silently dropped; once the run terminates (any status), a new trigger starts fresh so board cycles (Dev → Review → Dev) keep re-firing the workflow. Handled at the Temporal boundary:

- `agentWorkflow` for a `ticket-branch` workflow is started with deterministic ID `run-<workflowId>-<ticketId>`.
- `WorkflowIdReusePolicy = ALLOW_DUPLICATE` (Temporal default; stated explicitly because it's load-bearing for board cycles) — after termination, the same ID can be reused, so a ticket re-entering `Dev` triggers a fresh Worker run.
- `WorkflowIdConflictPolicy = FAIL` (Temporal's default for an already-running ID) — starting a second workflow with the ID of an in-flight one throws `WorkflowExecutionAlreadyStarted`. The API / trigger handler catches it, logs at debug, and drops the trigger: webhook handlers return 200 so the platform doesn't retry; poll-loop skips are internal. No `WorkflowRun` row is created for the dropped trigger.

For non-`ticket-branch` workflows, the workflow ID is per-run (`run-<runId>`) with no dedup key — concurrent runs on the same ticket are allowed and operate on independent ephemeral worktrees.

The base-clone file lock mentioned in the lifecycle step 2 covers the smaller window where two *different* workflows or tickets might race on `git worktree add` against the same shared base clone.

See [branch-management.md](./branch-management.md) for the full concurrency model.

## Cleanup for `ticket-branch` workspaces

`cleanupRunActivity` runs at end-of-workflow for all workspace kinds. For `ticket-branch`, two things differ:

1. **Remote branch preserved.** The local worktree is cleaned (tmpdir rm + `git worktree prune`), but the remote branch and its pushed commits stay put — they're the persistent state that iteration N+1 consumes.
2. **Unpushed-commits warning.** Before cleanup, the runtime checks whether local commits were pushed, using **local state only** (no `git fetch`):
   - If `origin/<branch>` doesn't exist yet, all local commits are treated as unpushed.
   - Otherwise, `git log origin/<branch>..HEAD` gives the diff.
   - The no-fetch choice means the check can false-positive if the remote advanced during the run — acceptable tradeoff, since the goal is catching the "no agent ever pushed" footgun, not perfectly accounting for concurrent pushers.
   - A warning is emitted to `ExecutionLog` without blocking the run.

## Constraints enforcement

`AgentConstraints` (max turns, tokens, tool calls, timeout) are enforced **inside the provider adapter** — it counts events and throws `ConstraintExceededError` when breached. Timeout is a Temporal activity-level `startToCloseTimeout` *and* a provider-level wall-clock guard (belt + suspenders).
