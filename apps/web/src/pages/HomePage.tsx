import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TemplatePickerDialog } from '../components/templates/TemplatePickerDialog.js';
import { useCreateWorkflow, useWorkflows } from '../api/hooks.js';
import type { WorkflowRow } from '../api/types.js';
import { duration, relativeFromNow } from '../lib/time.js';
import { cn } from '../lib/cn.js';
import { statusClass } from '../lib/status.js';

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
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Workflows<em className="text-[var(--color-claude)] not-italic">.</em>
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
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
            <WorkflowRowItem key={wf.id} wf={wf} />
          ))}
        </div>
      </section>

      {showTemplatePicker && (
        <TemplatePickerDialog onClose={() => setShowTemplatePicker(false)} />
      )}
    </div>
  );
}

function WorkflowRowItem({ wf }: { wf: WorkflowRow }) {
  const lastRun = wf.runs[0];
  const agentCount = wf.definition?.nodes?.length ?? 0;
  const providers = new Set(wf.definition?.nodes?.map((n) => n.provider) ?? []);

  return (
    <Link
      to={`/workflows/${wf.id}`}
      className="grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1fr)_140px_60px] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--color-bg-2)]"
    >
      <span className={cn('status-dot', statusClass(lastRun?.status))} />
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px] font-medium text-[var(--color-text)]">{wf.name}</div>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-[var(--color-text-3)]">
          {providers.has('claude') && <span className="prov-glyph claude">C</span>}
          {providers.has('codex') && <span className="prov-glyph codex">X</span>}
          <span>{agentCount} agent{agentCount === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="truncate font-mono text-[11px] text-[var(--color-text-2)]">
        {wf.definition?.trigger?.platform ? (
          <>
            <b className="text-[var(--color-text)]">
              {wf.definition.trigger.platform.toUpperCase()}
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
        <span className={cn('pill', wf.isActive ? '' : 'opacity-40')}>
          <span className="dot" style={{ background: wf.isActive ? 'var(--color-success)' : 'var(--color-text-4)' }} />
          {wf.isActive ? 'on' : 'off'}
        </span>
      </div>
    </Link>
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

function triggerSummary(def: WorkflowRow['definition']): string {
  const trigger = def.trigger;
  if (trigger.mode.kind === 'webhook') return trigger.mode.event;
  return `polling · every ${trigger.mode.intervalSec}s`;
}
