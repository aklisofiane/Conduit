import { type MouseEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRerunRun, useWorkflowRuns } from '../../api/hooks.js';
import type { RunTrigger, WorkflowRunListItem } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { statusClass } from '../../lib/status.js';
import { duration, relativeFromNow } from '../../lib/time.js';
import { Button } from '../ui/button.js';
import { Card } from '../ui/card.js';

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

      <Card padded={false}>
        {isLoading && <EmptyRow text="Loading runs…" />}
        {!isLoading && runs.length === 0 && (
          <EmptyRow text="No runs yet — they'll appear once the trigger fires." />
        )}
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </Card>
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRunListItem }) {
  const navigate = useNavigate();
  const rerun = useRerunRun();
  const [note, setNote] = useState<string | null>(null);
  const total = run.nodes.length;
  const done = run.nodes.filter((n) => n.status === 'COMPLETED').length;
  const dur =
    run.status === 'RUNNING' || run.status === 'PENDING'
      ? `running · ${duration(run.startedAt)}`
      : duration(run.startedAt, run.finishedAt);

  const isError = run.status === 'FAILED' && Boolean(run.error);
  const subtitle = isError ? run.error : triggerSubtitle(run.trigger);

  async function handleRerun(e: MouseEvent) {
    // The whole row is a Link — keep the click from navigating to the
    // (stale) failed run while we kick off a fresh one.
    e.preventDefault();
    e.stopPropagation();
    setNote(null);
    try {
      const next = await rerun.mutateAsync(run.id);
      if (next) navigate(`/runs/${next.id}`);
      else setNote('newer run active');
    } catch {
      setNote('rerun failed');
    }
  }

  return (
    <Link
      to={`/runs/${run.id}`}
      className="group grid grid-cols-[20px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_140px] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--color-bg-2)]"
    >
      <span className={cn('status-dot', statusClass(run.status))} />
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px] font-medium text-[var(--color-text)]">
          {triggerHeadline(run.trigger)}
        </div>
        {subtitle && (
          <div
            className={cn(
              'mt-0.5 truncate font-mono text-[11px]',
              isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-3)]',
            )}
          >
            {subtitle}
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
      <div className="flex items-center justify-end gap-2 text-right font-mono text-[11px] text-[var(--color-text-2)]">
        {run.status === 'FAILED' &&
          (note ? (
            <span className="text-[var(--color-text-3)]">{note}</span>
          ) : (
            <Button
              type="button"
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={handleRerun}
              disabled={rerun.isPending}
            >
              {rerun.isPending ? '…' : 'Rerun'}
            </Button>
          ))}
        <span>{dur}</span>
      </div>
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

function triggerHeadline(trigger: RunTrigger): string {
  if (trigger.issue) {
    // Repo is implicit (one workflow → one repo); Jira keys look like ids, GitHub/GitLab keys are numeric.
    const ref = trigger.source === 'jira' ? trigger.issue.key : `#${trigger.issue.key}`;
    return trigger.issue.title ? `${ref} — ${trigger.issue.title}` : ref;
  }
  if (trigger.event && trigger.event !== trigger.source) {
    return `${trigger.source} · ${trigger.event}`;
  }
  return trigger.source;
}

function triggerSubtitle(trigger: RunTrigger): string {
  const parts: string[] = [];
  if (trigger.issue) parts.push(`${trigger.source} · ${trigger.event}`);
  if (trigger.actor) parts.push(`by ${trigger.actor}`);
  return parts.join(' · ');
}
