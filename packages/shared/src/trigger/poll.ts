import { z } from 'zod';

/**
 * Input for the poll workflow / activity. Just the Conduit workflow id —
 * everything else (trigger config, connection, board) is re-read from the
 * DB inside the activity so schedule definitions stay tiny and don't need
 * to be rewritten when a workflow's trigger config changes.
 */
export const pollWorkflowInputSchema = z.object({
  workflowId: z.string().min(1),
});
export type PollWorkflowInput = z.infer<typeof pollWorkflowInputSchema>;

/**
 * One row in the poll-cycle summary written to `ExecutionLog` for audit.
 * Surfaced as the `pollWorkflow` return value so each tick's "Result" tab
 * in the Temporal UI tells the full story of which gate dropped events.
 */
export interface PollCycleResult {
  workflowId: string;
  /** Why the activity exited early. `undefined` means it ran the full diff. */
  skipReason?: 'inactive' | 'not-polling';
  /** Items returned by the platform query (pre-filter). */
  fetchedCount: number;
  /** Items that survived `itemPassesFilters`. */
  matchedCount: number;
  /** Items that survived but were already in the previous PollSnapshot. */
  alreadySeenCount: number;
  /** New items (matched − alreadySeen) — these enter the second gate. */
  newCount: number;
  /** Items dropped by the `matchesTrigger` second-gate validator. */
  gatedOutCount: number;
  /** WorkflowRun ids successfully started this tick. */
  startedRunIds: string[];
  /** Per-event start failures. Empty when nothing failed. */
  failedStarts: Array<{
    issueKey?: string;
    reason: 'duplicate' | 'error';
    error?: string;
  }>;
  /**
   * Matching item keys in *current* cycle — persisted to `PollSnapshot.matchingIds`
   * so the next cycle can diff against it. Stable identifier per platform:
   *   - GitHub Projects v2: the project item `node_id` (PVTI_...)
   */
  matchingIds: string[];
}
