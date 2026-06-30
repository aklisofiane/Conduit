import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCancelRun, useRerunRun, useRun, useRunLogs } from '../api/hooks.js';
import type { ExecutionLogRow, NodeRunRow } from '../api/types.js';
import { ChangedFiles } from '../components/run/ChangedFiles.js';
import { NodeError } from '../components/run/NodeError.js';
import { NodeSummary } from '../components/run/NodeSummary.js';
import { RunTimeline } from '../components/run/RunTimeline.js';
import { useRunUpdates } from '../hooks/use-run-updates.js';
import { duration, relativeFromNow } from '../lib/time.js';
import { cn } from '../lib/cn.js';
import { workflowNodeRank } from '../lib/node-order.js';
import { statusClass } from '../lib/status.js';
import { Button } from '../components/ui/button.js';
import { SelectableCard } from '../components/ui/selectable-card.js';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.js';

type NodeTab = 'timeline' | 'summary' | 'files' | 'error';

const NODE_TABS: Array<{ id: NodeTab; label: string }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'summary', label: 'Summary' },
  { id: 'files', label: 'Changed files' },
  { id: 'error', label: 'Error' },
];

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { data: run } = useRun(runId);
  const cancelRun = useCancelRun();
  const rerunRun = useRerunRun();
  const [rerunNote, setRerunNote] = useState<string | null>(null);
  const latestFrame = useRunUpdates(runId);
  const [selectedNode, setSelectedNode] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<NodeTab>('timeline');

  async function handleRerun() {
    if (!runId) return;
    setRerunNote(null);
    try {
      const next = await rerunRun.mutateAsync(runId);
      if (next) navigate(`/runs/${next.id}`);
      else setRerunNote('A newer run for this ticket is already active.');
    } catch {
      setRerunNote('Rerun failed — please try again.');
    }
  }

  // Order the rail by the workflow graph (scope first, publish last) rather
  // than the alphabetical order Postgres returns from the unique constraint.
  const orderedNodes = useMemo(() => {
    const rank = workflowNodeRank(run?.workflow.definition);
    return [...(run?.nodes ?? [])].sort(
      (a, b) =>
        (rank.get(a.nodeName) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.nodeName) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [run?.nodes, run?.workflow.definition]);

  useEffect(() => {
    const first = orderedNodes[0]?.nodeName;
    if (first) setSelectedNode((prev) => prev ?? first);
  }, [orderedNodes]);

  const selected = run?.nodes.find((n) => n.nodeName === selectedNode);
  const autoSwitchedNodes = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Reset the per-node auto-switch memory when viewing a different run.
    autoSwitchedNodes.current.clear();
  }, [runId]);
  useEffect(() => {
    // Auto-switch to Error tab the first time a failed node is shown so users
    // don't hunt for it — but only once per node, so they can still navigate
    // back to Timeline afterwards (even after visiting other failed nodes).
    if (selected?.status === 'FAILED' && !autoSwitchedNodes.current.has(selected.nodeName)) {
      autoSwitchedNodes.current.add(selected.nodeName);
      setActiveTab('error');
    }
  }, [selected?.status, selected?.nodeName]);

  const { data: logs = [] } = useRunLogs(runId, selectedNode);
  const orderedEvents = useOrderedEvents(logs);

  const tokens = useMemo(
    () =>
      (run?.nodes ?? []).reduce(
        (acc, n) => {
          const u = n.usage ?? {};
          return {
            input: acc.input + (u.inputTokens ?? 0),
            output: acc.output + (u.outputTokens ?? 0),
          };
        },
        { input: 0, output: 0 },
      ),
    [run?.nodes],
  );

  const status = run?.status ?? 'PENDING';
  const streaming = status === 'RUNNING' || status === 'PENDING';

  if (!runId) return null;
  if (!run) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-small text-[var(--color-text-muted)]">
        Loading run…
      </div>
    );
  }

  const branchName = ticketBranchName(run.nodes);

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-6 py-5">
        <div className="font-mono text-small text-[var(--color-text-muted)]">
          <Link to="/" className="hover:text-[var(--color-text)]">
            workflows
          </Link>{' '}
          /{' '}
          <Link to={`/workflows/${run.workflowId}`} className="hover:text-[var(--color-text)]">
            {run.workflow.name}
          </Link>{' '}
          /{' '}
          <Link
            to={`/workflows/${run.workflowId}?tab=runs`}
            className="hover:text-[var(--color-text)]"
          >
            runs
          </Link>{' '}
          / <span className="text-[var(--color-text)]">{run.id}</span>
        </div>
        <div className="mt-2 flex items-start gap-4">
          <div className="flex-1">
            <div
              className="text-heading font-semibold leading-tight tracking-tight"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {run.workflow.name}
              {run.trigger.issue && (
                <span className="text-[var(--color-text-muted)]">
                  {' · '}
                  {run.trigger.issue.title}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-small text-[var(--color-text-muted)]">
              <StatusBadge status={status} />
              <span>
                trigger: {run.trigger.source} · {run.trigger.event}
              </span>
              <span>started {relativeFromNow(run.startedAt)}</span>
              <span>elapsed {duration(run.startedAt, run.finishedAt)}</span>
              <span>
                tokens: {tokens.input.toLocaleString()} in · {tokens.output.toLocaleString()} out
              </span>
              {branchName && (
                <span className="text-[var(--color-text-2)]">
                  branch · <span className="text-[var(--color-text)]">{branchName}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-2">
              {run.trigger.issue && (
                <Button asChild>
                  <a href={run.trigger.issue.url} target="_blank" rel="noreferrer">
                    Open issue ↗
                  </a>
                </Button>
              )}
              {streaming && (
                <Button
                  variant="danger"
                  onClick={() => cancelRun.mutate(runId)}
                  disabled={cancelRun.isPending}
                >
                  {cancelRun.isPending ? 'Cancelling…' : 'Cancel run'}
                </Button>
              )}
              {status === 'FAILED' && (
                <Button onClick={handleRerun} disabled={rerunRun.isPending}>
                  {rerunRun.isPending ? 'Rerunning…' : 'Rerun'}
                </Button>
              )}
            </div>
            {rerunNote && (
              <span className="font-mono text-small text-[var(--color-text-muted)]">{rerunNote}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] shrink-0 border-r border-[var(--color-divider)] bg-[var(--color-bg-panel)] p-3">
          <h4 className="mb-2 px-1 font-mono text-caption uppercase tracking-wider text-[var(--color-text-muted)]">
            Execution · {run.nodes.length} node{run.nodes.length === 1 ? '' : 's'}
          </h4>
          <div className="space-y-1">
            {orderedNodes.map((node) => (
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
              <div className="px-2 font-mono text-small text-[var(--color-text-muted)]">
                No nodes have started yet.
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 items-center gap-4 border-b border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-4">
            <div className="font-mono text-small font-semibold">{selectedNode ?? '—'}</div>
            <ToggleGroup
              type="single"
              value={activeTab}
              onValueChange={(v) => v && setActiveTab(v as NodeTab)}
              variant="subtle"
              className="gap-0.5"
              aria-label="Node detail tab"
            >
              {NODE_TABS.map((tab) => (
                <ToggleGroupItem key={tab.id} value={tab.id} className="rounded-md">
                  {tab.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {streaming && activeTab === 'timeline' && (
              <div className="flex items-center gap-1.5 font-mono text-small text-[var(--color-running)]">
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{
                    background: 'var(--color-running)',
                    boxShadow: '0 0 6px var(--color-running)',
                  }}
                />
                streaming
              </div>
            )}
            {latestFrame && activeTab === 'timeline' && (
              <div className="font-mono text-small text-[var(--color-text-muted)]">
                last: {latestFrame.event.type}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {selected ? (
              <NodeTabBody
                tab={activeTab}
                node={selected}
                events={orderedEvents}
                streaming={streaming}
              />
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-small text-[var(--color-text-muted)]">
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
    <SelectableCard
      tone="fill"
      selected={selected}
      onClick={onClick}
      className="flex items-start gap-2.5 px-2 py-2"
    >
      <span className={cn('status-dot mt-1', statusClass(node.status))} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between font-mono text-small font-medium">
          <span className="truncate">{node.nodeName}</span>
          <span className="ml-2 font-mono text-caption text-[var(--color-text-muted)]">
            {node.finishedAt
              ? duration(node.startedAt, node.finishedAt)
              : node.startedAt
                ? `${duration(node.startedAt)}…`
                : '—'}
          </span>
        </div>
        <div className="font-mono text-caption text-[var(--color-text-muted)]">
          {labelForStatus(node.status)}
        </div>
      </div>
    </SelectableCard>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-caption uppercase tracking-wider',
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
      return 'border-[var(--color-divider)] bg-[var(--color-pill-bg)] text-[var(--color-text-muted)]';
    default:
      return 'border-[var(--color-divider)] bg-[var(--color-pill-bg)] text-[var(--color-text-muted)]';
  }
}

function useOrderedEvents(events: ExecutionLogRow[]) {
  return useMemo(
    () => [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
    [events],
  );
}
