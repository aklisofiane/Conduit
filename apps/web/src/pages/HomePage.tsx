import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { TemplatePickerDialog } from '../components/templates/TemplatePickerDialog.js';
import { CreateWorkflowDialog } from '../components/workflow-list/CreateWorkflowDialog.js';
import type { PaletteTriggerType } from '../components/canvas/NodePalette.js';
import { WorkflowRowItem } from '../components/workflow-list/WorkflowRowItem.js';
import { useConnections, useCreateWorkflow, useWorkflows } from '../api/hooks.js';
import type { ConnectionRow, WorkflowRow } from '../api/types.js';
import { repoGroupRef, type RepoGroupRef } from '../lib/connection.js';
import { cn } from '../lib/cn.js';

const NO_REPO_KEY = '__no_repo__';

interface WorkflowGroup {
  key: string;
  ref: RepoGroupRef | null;
  rows: WorkflowRow[];
}

function groupWorkflowsByRepo(
  workflows: WorkflowRow[],
  connections: ConnectionRow[],
): WorkflowGroup[] {
  const connById = new Map(connections.map((c) => [c.id, c]));
  const order: string[] = [];
  const map = new Map<string, WorkflowGroup>();

  for (const wf of workflows) {
    const triggers = wf.definition?.triggers ?? [];
    const seenForThisWf = new Set<string>();
    let placed = false;
    for (const t of triggers) {
      const cid = t.connectionId;
      const conn = cid ? connById.get(cid) : undefined;
      const ref = conn
        ? repoGroupRef(conn.scope, conn.credential.platform, conn.credential.hostUrl)
        : null;
      if (!ref) continue;
      if (seenForThisWf.has(ref.key)) continue;
      seenForThisWf.add(ref.key);
      let group = map.get(ref.key);
      if (!group) {
        group = { key: ref.key, ref, rows: [] };
        map.set(ref.key, group);
        order.push(ref.key);
      }
      group.rows.push(wf);
      placed = true;
    }
    if (!placed) {
      let group = map.get(NO_REPO_KEY);
      if (!group) {
        group = { key: NO_REPO_KEY, ref: null, rows: [] };
        map.set(NO_REPO_KEY, group);
        order.push(NO_REPO_KEY);
      }
      group.rows.push(wf);
    }
  }

  // Repo groups stay in first-appearance order (= most-recent updatedAt first,
  // since the API delivers workflows by updatedAt desc). "No repo" is always
  // last regardless of when it first appeared.
  const repoKeys = order.filter((k) => k !== NO_REPO_KEY);
  const result = repoKeys.map((k) => map.get(k)!);
  if (map.has(NO_REPO_KEY)) result.push(map.get(NO_REPO_KEY)!);
  return result;
}

/**
 * Workflow list — the landing screen. Matches the mockup's layout: greeting
 * strip + stats (aggregated) + workflow table. The mockup also has an
 * attention band when something failed; that's gated on failure aggregation
 * which doesn't exist yet, so the band is omitted.
 */
export function HomePage() {
  const { data: workflows = [], isLoading } = useWorkflows();
  const { data: connections = [], isLoading: connectionsLoading } = useConnections();
  const navigate = useNavigate();
  const createWorkflow = useCreateWorkflow();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const activeCount = workflows.filter((w) => w.isActive).length;
  const runningCount = workflows.filter((w) => w.runs[0]?.status === 'RUNNING').length;
  const failingCount = workflows.filter((w) => w.runs[0]?.status === 'FAILED').length;

  const groups = useMemo(
    () => (connectionsLoading ? null : groupWorkflowsByRepo(workflows, connections)),
    [workflows, connections, connectionsLoading],
  );

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCreate = async (name: string, triggerType: PaletteTriggerType, connectionId?: string, platform?: 'github' | 'gitlab') => {
    const created = await createWorkflow.mutateAsync({ name, triggerType, connectionId, platform });
    setShowCreateDialog(false);
    navigate(`/workflows/${created.id}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-6 pb-16 pt-10">
      <section className="flex flex-col gap-2">
        <h1
          className="text-[44px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)', fontVariantLigatures: 'none' }}
        >
          Workflows
        </h1>
        <div className="font-mono text-[12px] text-[var(--color-text-2)]">
          <b className="text-[var(--color-text)]">{activeCount} active</b> ·{' '}
          <b className="text-[var(--color-text)]">{runningCount} runs</b> in flight ·{' '}
          {failingCount > 0 ? (
            <span className="text-[var(--color-error)]">{failingCount} needs attention</span>
          ) : (
            <span className="text-[var(--color-text-3)]">all good</span>
          )}
        </div>
      </section>

      <section className="grid grid-cols-4 gap-3">
        <StatCard label="Workflows" value={workflows.length.toString()} hint="total configured" />
        <StatCard label="Active" value={activeCount.toString()} hint="triggering on events" />
        <StatCard label="Running now" value={runningCount.toString()} hint="live runs" />
        <StatCard
          label="Failures · last run"
          value={failingCount.toString()}
          hint={failingCount > 0 ? 'needs attention' : 'all good'}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between">
          <h2 className="flex items-baseline gap-2 font-mono text-[12px] uppercase tracking-wider text-[var(--color-text-2)]">
            Your workflows
            <span className="text-[var(--color-text-4)]">{workflows.length}</span>
          </h2>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={() => setShowTemplatePicker(true)}>
              From template
            </button>
            <button className="btn primary" onClick={() => setShowCreateDialog(true)}>
              <Plus size={12} strokeWidth={2.5} />
              New workflow
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
          {isLoading && <EmptyRow text="Loading workflows…" />}
          {!isLoading && workflows.length === 0 && (
            <EmptyRow text="No workflows yet — click “New workflow” to get started." />
          )}
          {!isLoading && workflows.length > 0 && groups === null &&
            workflows.map((wf) => (
              <WorkflowRowItem
                key={wf.id}
                wf={wf}
                renaming={renamingId === wf.id}
                onStartRename={() => setRenamingId(wf.id)}
                onEndRename={() => setRenamingId((curr) => (curr === wf.id ? null : curr))}
              />
            ))}
          {!isLoading && groups !== null &&
            groups.flatMap((group) => {
              const collapsed = collapsedGroups.has(group.key);
              const header = (
                <button
                  key={`${group.key}:header`}
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={!collapsed}
                  className="flex w-full items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--color-bg-2)]"
                >
                  <ChevronRight
                    size={12}
                    strokeWidth={2}
                    className={cn(
                      'text-[var(--color-text-3)] transition-transform',
                      !collapsed && 'rotate-90',
                    )}
                  />
                  <div className="flex items-baseline gap-2 font-mono text-[12px]">
                    {group.ref ? (
                      <>
                        <span className="font-semibold text-[var(--color-text)]">
                          {group.ref.label}
                        </span>
                        <span className="text-[var(--color-text-3)]">
                          · {group.ref.platform}
                          {group.ref.hostUrl ? ` · ${group.ref.hostUrl}` : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-[var(--color-text)]">No repo</span>
                        <span className="text-[var(--color-text-3)]">· cron or unconfigured</span>
                      </>
                    )}
                  </div>
                  <span className="ml-auto font-mono text-[11px] text-[var(--color-text-3)]">
                    {group.rows.length} workflow{group.rows.length === 1 ? '' : 's'}
                  </span>
                </button>
              );
              if (collapsed) return [header];
              return [
                header,
                ...group.rows.map((wf) => (
                  <WorkflowRowItem
                    key={`${group.key}:${wf.id}`}
                    wf={wf}
                    renaming={renamingId === wf.id}
                    onStartRename={() => setRenamingId(wf.id)}
                    onEndRename={() =>
                      setRenamingId((curr) => (curr === wf.id ? null : curr))
                    }
                  />
                )),
              ];
            })}
        </div>
      </section>

      {showTemplatePicker && (
        <TemplatePickerDialog onClose={() => setShowTemplatePicker(false)} />
      )}
      {showCreateDialog && (
        <CreateWorkflowDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreate}
          isPending={createWorkflow.isPending}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
        {label}
      </div>
      <div
        className="mt-2 text-[28px] font-semibold tracking-tight text-[var(--color-text)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[11px] text-[var(--color-text-3)]">{hint}</div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex h-16 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
      {text}
    </div>
  );
}
