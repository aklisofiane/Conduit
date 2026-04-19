import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCancelRun, useRun, useRunLogs } from '../api/hooks.js';
import type { ExecutionLogRow, NodeRunRow } from '../api/types.js';
import { ChangedFiles } from '../components/run/ChangedFiles.js';
import { NodeError } from '../components/run/NodeError.js';
import { NodeSummary } from '../components/run/NodeSummary.js';
import { RunTimeline } from '../components/run/RunTimeline.js';
import { useRunUpdates } from '../hooks/use-run-updates.js';
import { duration, relativeFromNow } from '../lib/time.js';
import { cn } from '../lib/cn.js';
import { statusClass } from '../lib/status.js';

type NodeTab = 'timeline' | 'summary' | 'files' | 'error';

const NODE_TABS: Array<{ id: NodeTab; label: string }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'summary', label: 'Summary' },
  { id: 'files', label: 'Changed files' },
  { id: 'error', label: 'Error' },
];

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run } = useRun(runId);
  const cancelRun = useCancelRun();
  const latestFrame = useRunUpdates(runId);
  const [selectedNode, setSelectedNode] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<NodeTab>('timeline');

  useEffect(() => {
    const first = run?.nodes?.[0]?.nodeName;
    if (first) setSelectedNode((prev) => prev ?? first);
  }, [run]);

  const selected = run?.nodes.find((n) => n.nodeName === selectedNode);
  useEffect(() => {
    // Auto-switch to Error tab when a node fails so users don't hunt for it.
    if (selected?.status === 'FAILED' && activeTab === 'timeline') {
      setActiveTab('error');
    }
  }, [selected?.status, activeTab]);

  const { data: logs = [] } = useRunLogs(runId, selectedNode);
  const orderedEvents = useOrderedEvents(logs);

  const status = run?.status ?? 'PENDING';
  const streaming = status === 'RUNNING' || status === 'PENDING';

  if (!runId) return null;
  if (!run) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
        Loading run…
      </div>
    );
  }

  const tokens = useMemo(
    () =>
      run.nodes.reduce(
        (acc, n) => {
          const u = n.usage ?? {};
          return {
            input: acc.input + (u.inputTokens ?? 0),
            output: acc.output + (u.outputTokens ?? 0),
          };
        },
        { input: 0, output: 0 },
      ),
    [run.nodes],
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
        <div className="font-mono text-[11px] text-[var(--color-text-3)]">
          <Link to="/" className="hover:text-[var(--color-text)]">
            workflows
          </Link>{' '}
          /{' '}
          <Link to={`/workflows/${run.workflowId}`} className="hover:text-[var(--color-text)]">
            {run.workflow.name}
          </Link>{' '}
          / runs / <span className="text-[var(--color-text)]">{run.id}</span>
        </div>
        <div className="mt-2 flex items-start gap-4">
          <div className="flex-1">
            <div
              className="text-[24px] font-semibold leading-tight tracking-tight"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {run.workflow.name}
              {run.trigger.issue && (
                <span className="text-[var(--color-text-3)]">
                  {' · '}
                  {run.trigger.issue.title}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[11px] text-[var(--color-text-3)]">
              <StatusBadge status={status} />
              <span>trigger: {run.trigger.source} · {run.trigger.event}</span>
              <span>started {relativeFromNow(run.startedAt)}</span>
              <span>elapsed {duration(run.startedAt, run.finishedAt)}</span>
              <span>
                tokens: {tokens.input.toLocaleString()} in · {tokens.output.toLocaleString()} out
              </span>
              {ticketBranchName(run.nodes) && (
                <span className="text-[var(--color-text-2)]">
                  branch · <span className="text-[var(--color-text)]">{ticketBranchName(run.nodes)}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {run.trigger.issue && (
              <a className="btn" href={run.trigger.issue.url} target="_blank" rel="noreferrer">
                Open issue ↗
              </a>
            )}
            {streaming && (
              <button className="btn danger" onClick={() => cancelRun.mutate(runId)} disabled={cancelRun.isPending}>
                {cancelRun.isPending ? 'Cancelling…' : 'Cancel run'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] shrink-0 border-r border-[var(--color-line)] bg-[var(--color-bg-1)] p-3">
          <h4 className="mb-2 px-1 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
            Execution · {run.nodes.length} node{run.nodes.length === 1 ? '' : 's'}
          </h4>
          <div className="space-y-1">
            {run.nodes.map((node) => (
              <NodeRailItem
                key={node.id}
                node={node}
                selected={selectedNode === node.nodeName}
                onClick={() => {
                  setSelectedNode(node.nodeName);
                  // Reset to Timeline when the user picks a new node; the
                  // failed-node auto-switch still fires after selection.
                  setActiveTab('timeline');
                }}
              />
            ))}
            {run.nodes.length === 0 && (
              <div className="px-2 font-mono text-[11px] text-[var(--color-text-4)]">
                No nodes have started yet.
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 items-center gap-4 border-b border-[var(--color-line)] bg-[var(--color-bg-1)] px-4">
            <div className="font-mono text-[12px] font-semibold">
              {selectedNode ?? '—'}
            </div>
            <nav className="flex items-center gap-0.5">
              {NODE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors',
                    activeTab === tab.id
                      ? 'bg-[var(--color-bg-2)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-3)] hover:text-[var(--color-text)]',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            {streaming && activeTab === 'timeline' && (
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-running)]">
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ background: 'var(--color-running)', boxShadow: '0 0 6px var(--color-running)' }}
                />
                streaming
              </div>
            )}
            {latestFrame && activeTab === 'timeline' && (
              <div className="font-mono text-[11px] text-[var(--color-text-3)]">
                last: {latestFrame.event.type}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {selected ? (
              <NodeTabBody tab={activeTab} node={selected} events={orderedEvents} streaming={streaming} />
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
                Select a node to inspect.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function NodeTabBody({
  tab,
  node,
  events,
  streaming,
}: {
  tab: NodeTab;
  node: NodeRunRow;
  events: ExecutionLogRow[];
  streaming: boolean;
}) {
  switch (tab) {
    case 'timeline':
      return <RunTimeline events={events} streaming={streaming} />;
    case 'summary':
      return <NodeSummary node={node} />;
    case 'files':
      return <ChangedFiles node={node} />;
    case 'error':
      return <NodeError node={node} />;
  }
}

function NodeRailItem({
  node,
  selected,
  onClick,
}: {
  node: NodeRunRow;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border px-2 py-2 text-left transition-colors',
        selected
          ? 'border-[var(--color-line-2)] bg-[var(--color-bg-2)]'
          : 'border-transparent hover:bg-[var(--color-bg-2)]',
      )}
    >
      <span className={cn('status-dot mt-1', statusClass(node.status))} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between font-mono text-[12px] font-medium">
          <span className="truncate">{node.nodeName}</span>
          <span className="ml-2 font-mono text-[10.5px] text-[var(--color-text-3)]">
            {node.finishedAt
              ? duration(node.startedAt, node.finishedAt)
              : node.startedAt
                ? `${duration(node.startedAt)}…`
                : '—'}
          </span>
        </div>
        <div className="font-mono text-[10.5px] text-[var(--color-text-3)]">
          {labelForStatus(node.status)}
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider',
        statusBadgeClass(status),
      )}
    >
      <span className={cn('status-dot', statusClass(status))} />
      {status.toLowerCase()}
    </span>
  );
}

function labelForStatus(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'completed';
    case 'RUNNING':
      return 'live';
    case 'PENDING':
      return 'queued';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return status.toLowerCase();
  }
}

/**
 * Return the `conduit/*` branch name from any node whose workspace resolved
 * to a ticket-branch. Board-loop workflows always have exactly one.
 */
function ticketBranchName(nodes: NodeRunRow[]): string | undefined {
  for (const node of nodes) {
    if (node.output?.workspaceKind === 'ticket-branch' && node.output.branchName) {
      return node.output.branchName;
    }
  }
  return undefined;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.08)] text-[var(--color-running)]';
    case 'COMPLETED':
      return 'border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.08)] text-[var(--color-success)]';
    case 'FAILED':
      return 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] text-[var(--color-error)]';
    case 'CANCELLED':
      return 'border-[var(--color-line)] bg-[var(--color-bg-2)] text-[var(--color-text-3)]';
    default:
      return 'border-[var(--color-line)] bg-[var(--color-bg-2)] text-[var(--color-text-3)]';
  }
}

function useOrderedEvents(events: ExecutionLogRow[]) {
  return useMemo(
    () => [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
    [events],
  );
}
