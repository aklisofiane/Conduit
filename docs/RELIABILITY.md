# Reliability

Temporal carries most of the load. This doc covers what Conduit does on top of it.

## Failure modes and responses

| Failure | Behavior |
|---|---|
| Worker process crash mid-run | Temporal re-schedules in-flight activities on another worker. Agent node activity re-runs from scratch for the crashed node; completed nodes don't re-run. |
| Agent provider API error (rate limit, 5xx) | Activity retries with exponential backoff (Temporal retry policy). Max 3 attempts for transient, 0 for invalid-request errors. |
| MCP server crash | Activity fails, Temporal retries. On retry, MCP servers are re-spawned fresh. |
| MCP tool call fails (e.g. GitHub 422) | Returned to the agent as a tool result with error. The agent decides whether to retry, adapt, or give up. We do **not** retry tool calls at the runtime level — that's the agent's judgment call. |
| Agent hits `maxTurns` / `maxTokens` / `maxToolCalls` | Node marked FAILED with `ConstraintExceededError`. Run fails. |
| Concurrent workflows on same issue (race condition) | Known unsolved problem. Fast column moves on a board can trigger multiple workflows targeting the same issue simultaneously. Deferred to a later phase — see [PLANS.md](./PLANS.md). |
| Workflow cancellation (user clicks cancel) | Temporal cancels workflow → activities receive `CancelledFailure` → provider `AbortController.abort()` → MCP servers torn down → cleanup in `finally`. Run marked CANCELLED. |
| Webhook during DB down | API returns 503 to platform. Platform retries (GitHub retries webhook delivery). |

## Retry policy

Temporal activity retry defaults:
```ts
{
  initialInterval: '2s',
  backoffCoefficient: 2,
  maximumInterval: '60s',
  maximumAttempts: 3,
  nonRetryableErrorTypes: [
    'ValidationError',        // bad node config
    'ConstraintExceededError', // agent budget
    'UnauthorizedError',       // credential invalid
  ],
}
```

**Sequential merge-back after parallel groups**: each `mergeWorktreeActivity` runs as a separate Temporal activity with its own retry policy. If a merge fails (e.g. unresolvable conflict), the activity fails and the run fails — no automatic retry of the merge itself, since the conflict state is non-deterministic.

## Heartbeats

Every `AgentEvent` emitted by a provider triggers a Temporal heartbeat. This:
- Prevents `startToCloseTimeout` from killing long agent sessions mid-thought.
- Gives Temporal recent progress info for retries (resume hints, though we don't currently use them).
- Doubles as the live-update stream publish.

Activity-level timeouts:
- `startToCloseTimeout`: per-node, from `AgentConstraints.timeoutSec` (default 15 min).
- `heartbeatTimeout`: 60 seconds. If no event in 60s, something's wedged — kill it.

## Workspace cleanup

Workspaces live under `~/.conduit/runs/<runId>/<nodeName>/`. Per-agent worktrees persist for the **duration of the workflow run** — they're needed by `mergeWorktreeActivity` and `copyConduitFilesActivity` which run after parallel agents finish. Cleanup in two layers:

1. **`cleanupRunActivity(runId)`** — called once at the end of the workflow (success, failure, or cancel). Deletes workspace tmpdirs for this run, prunes git worktrees, deletes `.conduit/` folder.
2. **Periodic janitor** — cron job (or a Temporal schedule) that removes `~/.conduit/runs/*` directories older than 24h whose runId is in a terminal state. Handles worker-crash orphans where `cleanupRunActivity` didn't get to run.

MCP servers are torn down by the Claude/Codex SDK when the agent session ends — Conduit doesn't manage their lifecycle (see [mcp-servers.md](./design-docs/mcp-servers.md)).

Base clones under `~/.conduit/base-clones/` are long-lived and refreshed by the workspace manager on use.

## Log retention

`ExecutionLog` is append-only and high volume — a single agent turn with tool calls can produce 100+ rows. Without cleanup, the table grows unbounded.

**Policy**: delete `ExecutionLog` rows older than 30 days for runs in a terminal state (`COMPLETED`, `FAILED`, `CANCELLED`). Same mechanism as the workspace janitor — a Temporal schedule or cron job that runs daily.

`NodeRun` and `WorkflowRun` rows are kept indefinitely (small tables, useful for history). Only the high-volume event log is pruned.

Future upgrade path: archive old logs to cold storage (S3/file) before deletion if audit trail requirements emerge.

## Crash recovery guarantees

- **Workflow-level**: Temporal guarantees the workflow function runs to completion (or failure/cancellation) across worker crashes.
- **Node-level**: completed nodes persist `NodeRun.status = COMPLETED`. On workflow resume after a crash, the workflow code re-runs, but completed activities short-circuit via Temporal's event history.
- **Mid-agent crash**: the current in-flight node re-runs from the start. Agent providers are not resumable — we don't try to recover partial agent sessions. MCP servers are re-spawned fresh on retry.

## Observability

v1 is deliberately light:
- `ExecutionLog` rows give a full replay of any run.
- Temporal UI (port 8080) shows workflow history for deep debugging.
- API logs structured JSON to stdout; production ships via the user's log aggregator.
- No metrics/tracing integration in v1 (document the extension points — OpenTelemetry hook in the worker bootstrap).

## Degraded mode

If Redis is down:
- Runs still execute (Temporal + Postgres are the critical path).
- Live updates stop — UI falls back to polling `GET /runs/:id` every 2 seconds.
- `ExecutionLog` still writes.

If Postgres is down:
- API returns 503 for writes.
- In-flight runs fail on their next DB write and Temporal retries.

If Temporal is down:
- New runs can't start; API returns 503 on webhook receipt (platform retries).
- In-flight runs pause and resume when Temporal recovers.
