import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { TemplatePickerDialog } from '../components/templates/TemplatePickerDialog.js';
import { WorkflowRowItem } from '../components/workflow-list/WorkflowRowItem.js';
import { useCreateWorkflow, useWorkflows } from '../api/hooks.js';

/**
 * Workflow list — the landing screen. Matches the mockup's layout: greeting
 * strip + stats (aggregated) + workflow table. The mockup also has an
 * attention band when something failed; that's gated on failure aggregation
 * which doesn't exist yet, so the band is omitted.
 */
export function HomePage() {
  const { data: workflows = [], isLoading } = useWorkflows();
  const navigate = useNavigate();
  const createWorkflow = useCreateWorkflow();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const activeCount = workflows.filter((w) => w.isActive).length;
  const runningCount = workflows.filter((w) => w.runs[0]?.status === 'RUNNING').length;
  const failingCount = workflows.filter((w) => w.runs[0]?.status === 'FAILED').length;

  const handleCreate = async () => {
    const created = await createWorkflow.mutateAsync({ name: 'Untitled workflow' });
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
            <button className="btn primary" onClick={handleCreate} disabled={createWorkflow.isPending}>
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
          {workflows.map((wf) => (
            <WorkflowRowItem
              key={wf.id}
              wf={wf}
              renaming={renamingId === wf.id}
              onStartRename={() => setRenamingId(wf.id)}
              onEndRename={() => setRenamingId((curr) => (curr === wf.id ? null : curr))}
            />
          ))}
        </div>
      </section>

      {showTemplatePicker && (
        <TemplatePickerDialog onClose={() => setShowTemplatePicker(false)} />
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
