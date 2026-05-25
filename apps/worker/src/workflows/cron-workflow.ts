import { proxyActivities } from '@temporalio/workflow';
import type { CronWorkflowInput } from '@conduit/shared';
import type * as activities from '../activities/index';
import type { CronFireResult } from '../activities/cron-fire';

const { cronFireActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    // One tick is cheap — if it fails, wait for the next scheduled
    // calendar tick rather than burning retries.
    maximumAttempts: 2,
    nonRetryableErrorTypes: ['ValidationError'],
  },
});

/** Scheduled "fire once" — cadence + overlap=SKIP live on the schedule. */
export async function cronWorkflow(input: CronWorkflowInput): Promise<CronFireResult> {
  return cronFireActivity(input);
}
