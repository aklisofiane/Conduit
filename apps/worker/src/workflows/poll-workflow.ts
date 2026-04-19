import { proxyActivities } from '@temporalio/workflow';
import type { PollCycleResult, PollWorkflowInput } from '@conduit/shared';
import type * as activities from '../activities/index';

const { pollBoardActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    // A single poll cycle is cheap — if it fails, just wait for the next
    // scheduled tick rather than burning retries on a flaky upstream.
    maximumAttempts: 2,
    nonRetryableErrorTypes: ['ValidationError'],
  },
});

/**
 * Scheduled "poll once" workflow. The Temporal Schedule drives invocation
 * frequency; this workflow itself is trivial — it runs a single activity and
 * returns the cycle summary for Temporal history / event-log inspection.
 *
 * Runs one Conduit workflow at a time. Overlap between ticks is prevented
 * at the schedule level (`overlap = SKIP`), so a slow poll never piles up.
 */
export async function pollWorkflow(input: PollWorkflowInput): Promise<PollCycleResult> {
  return pollBoardActivity(input);
}
