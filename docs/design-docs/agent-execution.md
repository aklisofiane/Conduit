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
| `cleanupRunActivity(runId)` | Best-effort cleanup after run ends — deletes workspace tmpdirs, prunes git worktrees, deletes `.conduit/` folder |

Activities use Temporal **heartbeats** so long-running agent sessions don't get killed for inactivity. Heartbeat payload carries current tool call + token count — doubles as the live update stream.

## `runAgentNode` lifecycle

```
1. Build AgentContext from triggerEvent (slim: { trigger, workflow, run })
2. Resolve workspace:
     - fresh-tmpdir → mkdtemp
     - repo-clone   → workspaceManager.seed(connection, ref)
     - inherit      → branch worktree from upstream's HEAD (or reuse if sequential)
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
5. Invoke provider.execute({ model, instructions, context, mcpServers, workspace, constraints })
     - Stream events: text chunk, tool call start, tool call result, token delta
     - For each event: heartbeat + publish to Redis conduit:run-updates
6. Final prompt (appended to the agent conversation after main work):
     - Write .conduit/<NodeName>.md — summary of what the agent did, issues, context for downstream
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
  getCapabilities(): ProviderCapabilities;  // models, max tokens, MCP support
  execute(req: AgentRequest): AsyncIterable<AgentEvent>;
  // Cancellation via AbortSignal on req.signal
}

type AgentRequest = {
  model: string;
  systemPrompt: string;              // agent node's instructions
  userMessage: string;               // serialized AgentContext: { trigger, workflow, run } (see agent-context.md)
  mcpServers: ResolvedMcpServer[];   // configs with credentials substituted; SDK spawns/manages them
  workspacePath: string;             // always present — workspace is required
  constraints: AgentConstraints;
  signal: AbortSignal;
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
- **Strip auth from remote URLs** after seeding (prevents tokens leaking into agent-visible config).
- **Cleanup** on activity finish (tmpdir rm + `git worktree prune`).

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

`mergeWorktreeActivity` is not a raw `git merge` — it's a lightweight agent session. A plain `git merge` would fail on conflicts and break the flow. Instead:

1. Spin up a short-lived agent session with the same provider as the node being merged.
2. Hardcoded system prompt (not user-customizable in v1): "Merge branch X into Y. If there are conflicts, read the conflicting files, understand the intent of both changes, and resolve them sensibly. Commit the result."
3. The agent has workspace tools only (file read/write/edit, shell, glob, grep). No MCP servers.
4. On clean merge: the agent runs `git merge`, confirms success, done. Fast — one turn.
5. On conflict: the agent reads conflict markers, resolves them, commits. May take a few turns.

Cost: one extra LLM call per parallel agent. In practice, most merges are clean (parallel agents typically touch different files), so this is usually a single fast turn. Conflicts are the exception, and when they happen, an LLM is exactly what you want resolving them.

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

## Constraints enforcement

`AgentConstraints` (max turns, tokens, tool calls, timeout) are enforced **inside the provider adapter** — it counts events and throws `ConstraintExceededError` when breached. Timeout is a Temporal activity-level `startToCloseTimeout` *and* a provider-level wall-clock guard (belt + suspenders).
