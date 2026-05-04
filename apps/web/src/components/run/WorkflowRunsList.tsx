import { Link } from 'react-router-dom';
import { useWorkflowRuns } from '../../api/hooks.js';
import type { RunTrigger, WorkflowRunListItem } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { statusClass } from '../../lib/status.js';
import { duration, relativeFromNow } from '../../lib/time.js';

interface WorkflowRunsListProps {
  workflowId: string;
}

export function WorkflowRunsList({ workflowId }: WorkflowRunsListProps) {
  const { data: runs = [], isLoading } = useWorkflowRuns(workflowId);

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 px-6 pb-16 pt-8">
      <h2 className="flex items-baseline gap-2 font-mono text-[12px] uppercase tracking-wider text-[var(--color-text-2)]">
        Runs
        <span className="text-[var(--color-text-4)]">{runs.length}</span>
      </h2>

      <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
        {isLoading && <EmptyRow text="Loading runs…" />}
        {!isLoading && runs.length === 0 && (
          <EmptyRow text="No runs yet — they'll appear once the trigger fires." />
        )}
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRunListItem }) {
  const total = run.nodes.length;
  const done = run.nodes.filter((n) => n.status === 'COMPLETED').length;
  const dur =
    run.status === 'RUNNING' || run.status === 'PENDING'
      ? `running · ${duration(run.startedAt)}`
      : duration(run.startedAt, run.finishedAt);

  return (
    <Link
      to={`/runs/${run.id}`}
      className="grid grid-cols-[20px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_140px] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--color-bg-2)]"
    >
      <span className={cn('status-dot', statusClass(run.status))} />
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px] font-medium text-[var(--color-text)]">
          {run.id.slice(0, 8)}
        </div>
        {run.status === 'FAILED' && run.error ? (
          <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-error)]">
            {run.error}
          </div>
        ) : (
          <div className="mt-0.5 font-mono text-[11px] text-[var(--color-text-3)]">
            {triggerSummary(run.trigger)}
          </div>
        )}
      </div>
      <div className="font-mono text-[11px] text-[var(--color-text-2)]">
        {total > 0 ? (
          <>
            <b className="text-[var(--color-text)]">{done}</b>
            <span className="text-[var(--color-text-3)]">/{total}</span>{' '}
            <span className="text-[var(--color-text-3)]">
              node{total === 1 ? '' : 's'}
            </span>
          </>
        ) : (
          <span className="text-[var(--color-text-4)]">—</span>
        )}
      </div>
      <div className="font-mono text-[11px] text-[var(--color-text-2)]">
        {relativeFromNow(run.startedAt)}
      </div>
      <div className="text-right font-mono text-[11px] text-[var(--color-text-2)]">{dur}</div>
    </Link>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex h-16 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
      {text}
    </div>
  );
}

function triggerSummary(trigger: RunTrigger): string {
  if (trigger.issue) return `${trigger.source} · ${trigger.issue.key}`;
  if (trigger.event && trigger.event !== trigger.source) {
    return `${trigger.source} · ${trigger.event}`;
  }
  return trigger.source;
}
