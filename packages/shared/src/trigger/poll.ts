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
 * Not an end-user-facing shape; the activity emits it for observability.
 */
export interface PollCycleResult {
  workflowId: string;
  matchedCount: number;
  newCount: number;
  startedRunIds: string[];
  /**
   * Matching item keys in *current* cycle — persisted to `PollSnapshot.matchingIds`
   * so the next cycle can diff against it. Stable identifier per platform:
   *   - GitHub Projects v2: the project item `node_id` (PVTI_...)
   */
  matchingIds: string[];
}
