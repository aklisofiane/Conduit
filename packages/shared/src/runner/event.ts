import { z } from 'zod';
import { agentEventSchema } from '../runtime/event';

/**
 * One JSON object per line on the runner's stdout. Five kinds:
 *
 *   - `agent`     — passthrough of the provider's `AgentEvent` stream.
 *                   Orchestrator forwards each into its existing
 *                   `onAgentEvent` (counters, log-write, event-bus, Prisma).
 *   - `system`    — orchestrator-relevant log line that isn't an agent event
 *                   (startup banner, MCP startup notes, etc).
 *   - `heartbeat` — liveness ping. Independent of agent event flow so a
 *                   blocked SDK iterator (slow tool call) doesn't look dead.
 *   - `exit ok`   — terminal success. Carries the post-run workspace head,
 *                   `git status` summary, and the `.conduit/<NodeName>.md`
 *                   contents the orchestrator persists on `NodeRun`.
 *   - `exit err`  — terminal failure. Orchestrator translates this into a
 *                   thrown error so the activity flips `NodeRun` to FAILED.
 *
 * The orchestrator stops reading after the first `exit` event; the runner
 * exits its process immediately after emitting it.
 */
const exitOkSchema = z.object({
  kind: z.literal('exit'),
  ok: z.literal(true),
  /** Post-run HEAD when the workspace is git-backed; absent for fresh-tmpdir. */
  head: z.string().optional(),
  /** Files that differ from the workspace's baseline commit. */
  changedFiles: z.array(z.string()),
  /** Contents of `.conduit/<NodeName>.md` after the run. */
  conduitSummary: z.string().nullable(),
});

const exitErrSchema = z.object({
  kind: z.literal('exit'),
  ok: z.literal(false),
  error: z.object({
    message: z.string(),
    stack: z.string().optional(),
  }),
});

export const runnerEventSchema = z.union([
  z.object({ kind: z.literal('agent'), event: agentEventSchema }),
  z.object({ kind: z.literal('system'), message: z.string() }),
  z.object({ kind: z.literal('heartbeat') }),
  exitOkSchema,
  exitErrSchema,
]);
export type RunnerEvent = z.infer<typeof runnerEventSchema>;
