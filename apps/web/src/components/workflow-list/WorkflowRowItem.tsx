import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useConnections,
  useDeleteWorkflow,
  useDuplicateWorkflow,
  useUpdateWorkflow,
} from '../../api/hooks.js';
import { triggerSummary } from '../../lib/trigger-defaults.js';
import type { WorkflowRow } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { Badge, BadgeDot } from '../ui/badge.js';
import { downloadWorkflowExport } from '../../lib/export-workflow.js';
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
  const providers = useMemo(
    () => new Set(wf.definition?.nodes?.map((n) => n.provider) ?? []),
    [wf.definition?.nodes],
  );
  const trigger = wf.definition?.triggers?.[0];

  const update = useUpdateWorkflow(wf.id);
  const del = useDeleteWorkflow();
  const duplicate = useDuplicateWorkflow();
  const { data: connections = [] } = useConnections();
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

  const handleExport = () => {
    downloadWorkflowExport(
      { name: wf.name, description: wf.description, definition: wf.definition },
      connections,
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
            className="w-full bg-transparent px-0 py-0 font-mono text-base font-medium text-[var(--color-text)] outline-none"
          />
        ) : (
          <div className="truncate font-mono text-base font-medium text-[var(--color-text)]">
            {wf.name}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-2 font-mono text-small text-[var(--color-text-muted)]">
          {providers.has('claude') && (
            <Badge variant="glyph" provider="claude">
              C
            </Badge>
          )}
          {providers.has('codex') && (
            <Badge variant="glyph" provider="codex">
              X
            </Badge>
          )}
          <span>
            {agentCount} agent{agentCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div className="truncate font-mono text-small text-[var(--color-text-2)]">
        {trigger?.platform ? (
          <>
            <b className="text-[var(--color-text)]">
              {trigger.platform.toUpperCase()}
            </b>{' '}
            · {triggerSummary(trigger)}
          </>
        ) : (
          <span className="text-[var(--color-text-muted)]">— trigger not configured</span>
        )}
      </div>
      <div className="font-mono text-small text-[var(--color-text-2)]">
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
          <span className="text-[var(--color-text-muted)]">never run</span>
        )}
      </div>
      <div className="flex justify-end">
        <Badge
          asChild
          className={cn(
            'cursor-pointer transition-opacity hover:opacity-100 hover:ring-1 hover:ring-[var(--color-divider)] disabled:cursor-default disabled:opacity-60',
            wf.isActive ? '' : 'opacity-40',
          )}
        >
          <button
            type="button"
            aria-label={wf.isActive ? 'Deactivate workflow' : 'Activate workflow'}
            aria-pressed={wf.isActive}
            onClick={handleToggleActive}
            disabled={update.isPending}
          >
            <BadgeDot
              className={wf.isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}
            />
            {wf.isActive ? 'on' : 'off'}
          </button>
        </Badge>
      </div>
      <div className="flex justify-end">
        {renaming ? null : (
          <RowActionsMenu
            onRename={onStartRename}
            onDuplicate={handleDuplicate}
            onExport={handleExport}
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
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)] data-[state=open]:bg-[var(--color-pill-bg)] data-[state=open]:text-[var(--color-text)]"
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
      className={cn(rowClassName, 'transition-colors hover:bg-[var(--color-pill-bg)]')}
    >
      {inner}
    </Link>
  );
}

const rowClassName =
  'grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1fr)_140px_60px_28px] items-center gap-4 border-b border-[var(--color-divider)] px-4 py-3 last:border-b-0';
