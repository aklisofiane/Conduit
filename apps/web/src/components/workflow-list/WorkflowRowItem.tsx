import { Link, useNavigate } from 'react-router-dom';
import {
  useDeleteWorkflow,
  useDuplicateWorkflow,
  useUpdateWorkflow,
} from '../../api/hooks.js';
import type { WorkflowRow } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { duration, relativeFromNow } from '../../lib/time.js';
import { statusClass } from '../../lib/status.js';
import { MoreVertical } from 'lucide-react';
import { InlineRename } from '../common/InlineRename.js';
import { RowActionsMenu } from './RowActionsMenu.js';

const NAME_MAX_LENGTH = 120;

interface WorkflowRowItemProps {
  wf: WorkflowRow;
  renaming: boolean;
  onStartRename: () => void;
  onEndRename: () => void;
}

export function WorkflowRowItem({
  wf,
  renaming,
  onStartRename,
  onEndRename,
}: WorkflowRowItemProps) {
  const lastRun = wf.runs[0];
  const agentCount = wf.definition?.nodes?.length ?? 0;
  const providers = new Set(wf.definition?.nodes?.map((n) => n.provider) ?? []);

  const update = useUpdateWorkflow(wf.id);
  const del = useDeleteWorkflow();
  const duplicate = useDuplicateWorkflow();
  const navigate = useNavigate();

  const handleRenameCommit = (next: string) => {
    const trimmed = next.trim();
    onEndRename();
    if (!trimmed || trimmed === wf.name) return;
    if (trimmed.length > NAME_MAX_LENGTH) return;
    update.mutate(
      { name: trimmed },
      {
        onError: (err) => alert(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const handleDelete = () => {
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    del.mutate(wf.id, {
      onError: (err) => alert(err instanceof Error ? err.message : String(err)),
    });
  };

  const handleToggleActive = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (update.isPending) return;
    update.mutate(
      { isActive: !wf.isActive },
      {
        onError: (err) => alert(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const handleDuplicate = () => {
    duplicate.mutate(wf.id, {
      onSuccess: (created) => navigate(`/workflows/${created.id}`),
      onError: (err) => alert(err instanceof Error ? err.message : String(err)),
    });
  };

  const inner = (
    <>
      <span className={cn('status-dot', statusClass(lastRun?.status))} />
      <div className="min-w-0">
        {renaming ? (
          <InlineRename
            initial={wf.name}
            saving={update.isPending}
            onCommit={handleRenameCommit}
            onCancel={onEndRename}
            maxLength={NAME_MAX_LENGTH}
            className="w-full bg-transparent px-0 py-0 font-mono text-[13px] font-medium text-[var(--color-text)] outline-none"
          />
        ) : (
          <div className="truncate font-mono text-[13px] font-medium text-[var(--color-text)]">
            {wf.name}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-[var(--color-text-3)]">
          {providers.has('claude') && <span className="prov-glyph claude">C</span>}
          {providers.has('codex') && <span className="prov-glyph codex">X</span>}
          <span>
            {agentCount} agent{agentCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div className="truncate font-mono text-[11px] text-[var(--color-text-2)]">
        {wf.definition?.triggers?.[0]?.platform ? (
          <>
            <b className="text-[var(--color-text)]">
              {wf.definition.triggers[0].platform.toUpperCase()}
            </b>{' '}
            · {triggerSummary(wf.definition)}
          </>
        ) : (
          <span className="text-[var(--color-text-4)]">— trigger not configured</span>
        )}
      </div>
      <div className="font-mono text-[11px] text-[var(--color-text-2)]">
        {lastRun ? (
          <>
            <span className={cn('status-dot mr-1.5 inline-block', statusClass(lastRun.status))} />
            {relativeFromNow(lastRun.startedAt)} ·{' '}
            {lastRun.status === 'RUNNING'
              ? `running · ${duration(lastRun.startedAt)}`
              : lastRun.status === 'FAILED'
                ? 'failed'
                : duration(lastRun.startedAt, lastRun.finishedAt)}
          </>
        ) : (
          <span className="text-[var(--color-text-4)]">never run</span>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          aria-label={wf.isActive ? 'Deactivate workflow' : 'Activate workflow'}
          aria-pressed={wf.isActive}
          onClick={handleToggleActive}
          disabled={update.isPending}
          className={cn(
            'pill cursor-pointer transition-opacity hover:opacity-100 hover:ring-1 hover:ring-[var(--color-line)] disabled:cursor-default disabled:opacity-60',
            wf.isActive ? '' : 'opacity-40',
          )}
        >
          <span
            className="dot"
            style={{ background: wf.isActive ? 'var(--color-success)' : 'var(--color-text-4)' }}
          />
          {wf.isActive ? 'on' : 'off'}
        </button>
      </div>
      <div className="flex justify-end">
        {renaming ? null : (
          <RowActionsMenu
            onRename={onStartRename}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            duplicating={duplicate.isPending}
            deleting={del.isPending}
          >
            <button
              type="button"
              aria-label="Workflow actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-3)] transition-colors hover:bg-[var(--color-bg-2)] hover:text-[var(--color-text)] data-[state=open]:bg-[var(--color-bg-2)] data-[state=open]:text-[var(--color-text)]"
            >
              <MoreVertical size={14} strokeWidth={1.5} />
            </button>
          </RowActionsMenu>
        )}
      </div>
    </>
  );

  // Drop the <Link> while renaming so the input doesn't navigate on click.
  if (renaming) {
    return <div className={rowClassName}>{inner}</div>;
  }
  return (
    <Link
      to={`/workflows/${wf.id}`}
      className={cn(rowClassName, 'transition-colors hover:bg-[var(--color-bg-2)]')}
    >
      {inner}
    </Link>
  );
}

const rowClassName =
  'grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1fr)_140px_60px_28px] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 last:border-b-0';

function triggerSummary(def: WorkflowRow['definition']): string {
  const trigger = def.triggers[0];
  if (!trigger) return 'no trigger';
  switch (trigger.type) {
    case 'issues':
      return `polling · every ${trigger.intervalSec}s`;
    case 'pull_requests':
      return `polling · every ${trigger.intervalSec}s · prs`;
    case 'cron':
      return `schedule · ${trigger.cron} · ${trigger.timezone}`;
    case 'webhook':
      return trigger.event;
  }
}
