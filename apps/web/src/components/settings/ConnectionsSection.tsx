import { useMemo, useState } from 'react';
import { CONDUIT_LABELS } from '@conduit/shared/label';
import { isCloudHost } from '@conduit/shared/platform';
import type { Platform } from '@conduit/shared/platform';
import { ApiError, apiErrorMessage } from '../../api/client.js';
import {
  useConnectionAnalysis,
  useConnections,
  useCreateConnection,
  useCredentials,
  useDeleteConnection,
  useEnsureRepoLabels,
  useStartAnalysis,
} from '../../api/hooks.js';
import type { AnalysisPhase } from '@conduit/shared/analysis';
import type { ConnectionAnalysis, ConnectionRow } from '../../api/types.js';
import {
  ensureLabelTarget,
  scopeSummary,
  type EnsureLabelTarget,
} from '../../lib/connection.js';
import { InfoPopover } from '../ui/info-popover.js';
import { SettingsSection } from '../common/SettingsSection.js';
import { Badge, BadgeDot } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { CreateConnectionForm } from './ConnectionForm.js';
import { SuggestionsGalleryDialog } from './SuggestionsGalleryDialog.js';

/**
 * Connections are global, not per-workflow: a workflow's trigger and MCP slots
 * reference a connection id, and the same connection can back many workflows.
 */
export function ConnectionsSection() {
  const { data: connections = [], isLoading } = useConnections();
  const { data: credentials = [] } = useCredentials();
  const create = useCreateConnection();
  const del = useDeleteConnection();

  const [creating, setCreating] = useState(false);
  // After a repo/project connection is created, offer to add Conduit's labels
  // to it so label-gated templates work without hand-creating labels.
  const [labelPrompt, setLabelPrompt] = useState<EnsureLabelTarget | null>(null);

  return (
    <SettingsSection
      title="Connections"
      description="A connection picks a credential and pins it to a scope (a repo, a project board). Workflows reference connections directly."
      creating={creating}
      onToggleCreate={() => setCreating((v) => !v)}
    >
      {creating && (
        <CreateConnectionForm
          credentials={credentials}
          pending={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={async (body) => {
            try {
              const conn = await create.mutateAsync(body);
              setCreating(false);
              setLabelPrompt(ensureLabelTarget([conn], conn.id) ?? null);
            } catch (e) {
              alert(apiErrorMessage(e));
            }
          }}
        />
      )}

      {labelPrompt && (
        <LabelPrompt
          target={labelPrompt}
          onDismiss={() => setLabelPrompt(null)}
        />
      )}

      {isLoading && (
        <div className="flex h-16 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
          Loading…
        </div>
      )}
      {!isLoading && connections.length === 0 && !creating && (
        <div className="flex h-24 items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
          No connections yet.
        </div>
      )}
      {connections.map((conn) => (
        <ConnectionRowView
          key={conn.id}
          conn={conn}
          onDelete={async () => {
            if (!confirm(`Delete connection "${conn.name}"?`)) return;
            try {
              await del.mutateAsync(conn.id);
            } catch (e) {
              alert(e instanceof ApiError ? e.message : String(e));
            }
          }}
        />
      ))}
    </SettingsSection>
  );
}

/**
 * Post-create prompt offering to add Conduit's four workflow labels to a
 * freshly-created repo/project connection. Pre-checked checkboxes; Add calls
 * the ensure endpoint and reports per-label outcome; Skip dismisses with no
 * calls. `conduit-human-review` is included even though it's never a trigger
 * value — it's a writeback target that must exist on the repo/project.
 */
function LabelPrompt({
  target,
  onDismiss,
}: {
  target: EnsureLabelTarget;
  onDismiss: () => void;
}) {
  const ensure = useEnsureRepoLabels();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(CONDUIT_LABELS.map((l) => l.name)),
  );

  const resultByName = useMemo(
    () => new Map((ensure.data ?? []).map((r) => [r.name, r] as const)),
    [ensure.data],
  );
  // A 200 still carries per-label failures (e.g. a read-only token), so HTTP
  // success isn't terminal — only treat it as done when nothing failed.
  // Otherwise the prompt stays interactive so the failing labels can be retried.
  const hasFailures = (ensure.data ?? []).some((r) => r.status === 'failed');
  const done = ensure.isSuccess && !hasFailures;

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const add = () => {
    const names = [...selected];
    if (names.length > 0) ensure.mutate({ connectionId: target.connectionId, names });
  };

  const topLevelError = ensure.error ? apiErrorMessage(ensure.error) : null;

  return (
    <div className="border-b border-[var(--color-line)] px-4 py-4">
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2,var(--color-bg-1))] p-3">
        <div className="font-mono text-[12px]">
          Connected{' '}
          <code className="text-[var(--color-text)]">{target.scopeLabel}</code>{' '}
          ✓
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-3)]">
          Add Conduit's workflow labels to this repo/project?
        </div>

        <div className="flex flex-col gap-1.5">
          {CONDUIT_LABELS.map((l) => {
            const r = resultByName.get(l.name);
            return (
              <label
                key={l.name}
                className="flex items-center gap-2 font-mono text-[12px]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(l.name)}
                  disabled={ensure.isPending || done}
                  onChange={() => toggle(l.name)}
                />
                <code className="text-[var(--color-text)]">{l.name}</code>
                {r &&
                  (r.status === 'failed' ? (
                    <span className="text-[var(--color-danger,#dc322f)]">
                      ✗ {r.error ?? 'failed'}
                    </span>
                  ) : (
                    <span className="text-[var(--color-success,#2da44e)]">
                      ✓ {r.status}
                    </span>
                  ))}
              </label>
            );
          })}
        </div>

        {topLevelError && (
          <div className="font-mono text-[11px] text-[var(--color-danger,#dc322f)]">
            {topLevelError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {done ? (
            <Button onClick={onDismiss}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={onDismiss}>
                Skip
              </Button>
              <Button
                disabled={ensure.isPending || selected.size === 0}
                onClick={add}
              >
                {ensure.isPending
                  ? 'Adding…'
                  : hasFailures
                    ? 'Retry'
                    : 'Add labels'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Coarse phase → progress-card label. No raw logs ever reach the UI. */
const ANALYSIS_PHASE_LABEL: Record<AnalysisPhase, string> = {
  DISCOVER: 'Mapping components',
  DESIGN: 'Designing reviews',
  ASSEMBLE: 'Finalizing',
};

function ConnectionRowView({ conn, onDelete }: { conn: ConnectionRow; onDelete: () => void }) {
  const summary = scopeSummary(conn.scope);
  // Only repo/project-scoped connections can be analyzed — board and unscoped
  // connections have no repo to map components from.
  const isRepoScoped =
    conn.scope.kind === 'github_repo' || conn.scope.kind === 'gitlab_project';

  const { data: analysis } = useConnectionAnalysis(conn.id, isRepoScoped);
  const startAnalysis = useStartAnalysis();
  const [galleryOpen, setGalleryOpen] = useState(false);

  const status = analysis?.status;
  const running = status === 'PENDING' || status === 'ANALYZING';
  const ready = status === 'READY';
  const imported = ready && !!analysis?.importedAt;

  const onAnalyze = async () => {
    try {
      await startAnalysis.mutateAsync(conn.id);
    } catch (e) {
      alert(apiErrorMessage(e));
    }
  };

  return (
    <div className="border-b border-[var(--color-line)] last:border-b-0">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] font-mono text-[10.5px]">
          {conn.credential.platform.slice(0, 2)}
        </span>
        <div>
          <div className="font-mono text-[13px] font-medium">{conn.name}</div>
          <div className="font-mono text-[11px] text-[var(--color-text-3)]">
            {conn.credential.name} · {conn.credential.platform.toLowerCase()}
            {conn.credential.hostUrl &&
              !isCloudHost(conn.credential.platform as Platform, conn.credential.hostUrl) &&
              ` · ${conn.credential.hostUrl}`}
            {summary && ` · ${summary}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRepoScoped && ready && (
            <Badge asChild>
              <button type="button" onClick={() => setGalleryOpen(true)}>
                <BadgeDot />
                {imported ? 'Suggestions imported' : 'Suggestions ready'}
              </button>
            </Badge>
          )}
          {isRepoScoped &&
            (() => {
              const analyzeButton = (
                <Button
                  disabled={running || startAnalysis.isPending}
                  onClick={onAnalyze}
                >
                  {running ? 'Analyzing…' : ready ? 'Re-analyze' : 'Analyze repo'}
                </Button>
              );
              // Explain the action on first run, when its purpose is opaque.
              // Once it's running (progress card) or ready (suggestions pill),
              // the meaning is already clear, so render the bare button.
              return !ready && !running ? (
                <InfoPopover label="What “Analyze repo” does" trigger={analyzeButton}>
                  <AnalyzeRepoInfo />
                </InfoPopover>
              ) : (
                analyzeButton
              );
            })()}
          <Button onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      {isRepoScoped && analysis && (running || status === 'FAILED') && (
        <AnalysisProgressCard analysis={analysis} />
      )}

      {galleryOpen && analysis?.resultBundle && (
        <SuggestionsGalleryDialog
          connectionId={conn.id}
          analysisId={analysis.id}
          bundle={analysis.resultBundle}
          droppedComponents={analysis.droppedComponents ?? []}
          alreadyImported={imported}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Body of the `ⓘ` popover next to "Analyze repo" — explains the otherwise
 * opaque action: what it produces, the three coarse steps, and that it's a
 * read-only multi-minute run nothing imports without consent. Mirrors the
 * phase labels in {@link ANALYSIS_PHASE_LABEL} in plain language.
 */
/** The small numbered badge ahead of each step in {@link AnalyzeRepoInfo}. */
const stepNumClass =
  'mt-px flex h-[17px] w-[17px] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] font-mono text-[10px] font-semibold text-[var(--color-accent)]';

function AnalyzeRepoInfo() {
  return (
    <>
      <div className="mb-2 flex items-center gap-[7px] font-mono text-[12px] font-semibold text-[var(--color-text)]">
        <span className="text-[var(--color-accent)]">✦</span> What “Analyze repo” does
      </div>
      <p className="m-0 mb-2.5 text-[12px] leading-[1.5] text-[var(--color-text-2)] [&_b]:font-semibold [&_b]:text-[var(--color-text)]">
        Conduit reads the repo and proposes <b>ready-to-import review workflows</b> — one per
        component it finds.
      </p>
      <ul className="m-0 mb-2.5 grid list-none gap-[7px] p-0 [&>li]:grid [&>li]:grid-cols-[auto_1fr] [&>li]:gap-[9px] [&>li]:text-[11.5px] [&>li]:leading-[1.45] [&>li]:text-[var(--color-text-2)] [&_b]:font-semibold [&_b]:text-[var(--color-text)]">
        <li>
          <span className={stepNumClass}>1</span>
          <span>
            <b>Maps the components</b> in the codebase
          </span>
        </li>
        <li>
          <span className={stepNumClass}>2</span>
          <span>
            <b>Designs a scheduled review</b> for each — reviewer focus and a cadence
          </span>
        </li>
        <li>
          <span className={stepNumClass}>3</span>
          <span>
            You <b>pick which to import</b>; nothing runs until you do
          </span>
        </li>
      </ul>
      <div className="border-t border-[var(--color-divider)] pt-2.5 font-mono text-[10.5px] text-[var(--color-text-muted)]">
        ~ a few minutes · read-only
      </div>
    </>
  );
}

/**
 * Inline progress/result panel for an in-flight or failed analysis, in the same
 * bordered-card shape as `LabelPrompt`. Shows a coarse phase label and a pulsing
 * status dot while running; the server error when failed. Never shows raw logs.
 */
function AnalysisProgressCard({ analysis }: { analysis: ConnectionAnalysis }) {
  const failed = analysis.status === 'FAILED';
  return (
    <div className="px-4 pb-4">
      <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2,var(--color-bg-1))] p-3">
        <div className="flex items-center gap-2 font-mono text-[12px]">
          <span className={`status-dot ${failed ? 'error' : 'running'}`} />
          {failed ? 'Analysis failed' : ANALYSIS_PHASE_LABEL[analysis.phase]}
        </div>
        {failed ? (
          analysis.error && (
            <div className="font-mono text-[11px] text-[var(--color-danger,#dc322f)]">
              {analysis.error}
            </div>
          )
        ) : (
          <div className="font-mono text-[11px] text-[var(--color-text-3)]">
            Analyzing your repository — this can take a few minutes.
          </div>
        )}
      </div>
    </div>
  );
}
