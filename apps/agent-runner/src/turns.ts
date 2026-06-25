import type { AgentEvent } from '@conduit/shared';
import type { RunnerEvent } from '@conduit/shared/runner';
import { capAgentEvent } from './payload-cap';
import type { SecretRedactor } from './secret-redactor';
import { errorMessage } from './errors';

/** A provider session, narrowed to what the turn loop needs. */
export interface TurnSession {
  run(userMessage: string): AsyncIterable<AgentEvent>;
}

export interface RunTurnsOptions {
  session: TurnSession;
  prompts: { main: string; issueWriteback?: string; summary: string };
  emit: (event: RunnerEvent) => void;
  /**
   * Aborted to unblock a wedged summary turn once `summaryTimeoutMs` elapses.
   * Shared with the provider session, so only abort after the fatal turns.
   */
  abort: AbortController;
  /** Best-effort budget for the cosmetic summary turn. */
  summaryTimeoutMs?: number;
  /**
   * Redacts the run's known injected secrets from tool payloads before they're
   * emitted. Omitted when the run injected nothing worth redacting.
   */
  redactor?: SecretRedactor;
}

/** Twice the runner heartbeat interval — ample for a normal summary turn. */
export const SUMMARY_TURN_TIMEOUT_MS = 60_000;

/**
 * Drive the agent's turns: main work (fatal), optional issue writeback (fatal),
 * then the final summary (best-effort).
 *
 * The summary turn only writes the cosmetic `.conduit/<node>.md` recap — the
 * node's real work, and usually that file, is already produced by the turns
 * above. So a hang or error there must NOT discard a completed node: we bound
 * it with a timeout, downgrade any failure to a `system` log, and let the
 * caller emit `exit ok` with whatever the workspace already holds. (A
 * teardown-wedged provider child once flipped a finished review node to FAILED
 * and cancelled its siblings — this keeps that work.)
 */
export async function runAgentTurns(opts: RunTurnsOptions): Promise<void> {
  const { session, prompts, emit, abort, redactor } = opts;

  const drive = async (events: AsyncIterable<AgentEvent>): Promise<void> => {
    for await (const event of events) {
      emit({ kind: 'agent', event: capAgentEvent(event, redactor) });
    }
  };

  await drive(session.run(prompts.main));
  if (prompts.issueWriteback !== undefined) {
    await drive(session.run(prompts.issueWriteback));
  }

  const timeoutMs = opts.summaryTimeoutMs ?? SUMMARY_TURN_TIMEOUT_MS;
  const onTimeout = setTimeout(() => abort.abort(), timeoutMs);
  // The guard must not itself keep the runner alive after the work is done.
  onTimeout.unref?.();
  try {
    await drive(session.run(prompts.summary));
  } catch (err) {
    const message = errorMessage(err);
    emit({
      kind: 'system',
      message: `summary turn did not finish (${message}); completing node with work already produced`,
    });
  } finally {
    clearTimeout(onTimeout);
  }
}
