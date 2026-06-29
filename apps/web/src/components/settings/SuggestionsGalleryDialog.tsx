import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import type { TemplateFile, TemplateWorkflow } from '@conduit/shared/template';
import { apiErrorMessage } from '../../api/client.js';
import { useImportTemplate, useMarkAnalysisImported } from '../../api/hooks.js';
import type { DroppedComponent, TemplateBinding } from '../../api/types.js';
import { formatCadence } from '../../lib/cron.js';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.js';
import { Button } from '../ui/button.js';
import { Checkbox } from '../ui/checkbox.js';

// The analyzer's bundle binds exactly one connection placeholder — the repo it
// analyzed — under this alias (the `<github-repo>` placeholder without its
// brackets). We pre-bind it to the analyzed connection so import needs no form.
const REPO_ALIAS = 'github-repo';

/** Split a `"<summary>\n\nWhy: <rationale>"` description into its two halves. */
function splitDescription(description: string | undefined): {
  what: string;
  why: string | null;
} {
  if (!description) return { what: '', why: null };
  const marker = description.indexOf('Why:');
  if (marker === -1) return { what: description.trim(), why: null };
  return {
    what: description.slice(0, marker).trim(),
    why: description.slice(marker + 'Why:'.length).trim(),
  };
}

/** The proposed cadence text from a workflow's cron trigger, when it has one. */
function cadenceOf(workflow: TemplateWorkflow): string | null {
  const trigger = workflow.definition.triggers[0];
  if (!trigger || trigger.type !== 'cron') return null;
  return formatCadence(trigger.cron);
}

/**
 * Read-only gallery over a connection's READY analysis bundle. One card per
 * suggested review workflow with a select/deselect checkbox (all selected by
 * default); "Import selected" reuses the template-import endpoint with the
 * repo placeholder pre-bound to the analyzed connection. Mirrors the shape of
 * `TemplatePickerDialog` (controlled `onClose`, scrollable card list, footer
 * primary button with pending state).
 */
export function SuggestionsGalleryDialog({
  connectionId,
  analysisId,
  bundle,
  droppedComponents,
  alreadyImported,
  onClose,
}: {
  connectionId: string;
  analysisId: string;
  bundle: TemplateFile;
  droppedComponents: DroppedComponent[];
  /** This analysis's suggestions were already imported in a prior session. */
  alreadyImported: boolean;
  onClose: () => void;
}) {
  const importTemplate = useImportTemplate();
  const markImported = useMarkAnalysisImported(connectionId);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(bundle.workflows.map((_, i) => i)),
  );
  const [error, setError] = useState<string | null>(null);
  // Seed from the persisted flag so re-opening an already-imported analysis
  // shows the imported view instead of re-offering Import (which would create
  // duplicate workflows — import is not idempotent server-side).
  const [imported, setImported] = useState(alreadyImported);

  const toggle = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const importSelected = async () => {
    setError(null);
    const workflows = bundle.workflows.filter((_, i) => selected.has(i));
    if (workflows.length === 0) return;
    const template: TemplateFile = { ...bundle, workflows };
    const bindings: Record<string, TemplateBinding> = {
      [REPO_ALIAS]: { mode: 'existing', connectionId },
    };
    try {
      await importTemplate.mutateAsync({ template, bindings });
      setImported(true);
      // Persist the imported flag (best-effort — the UI already reflects it).
      await markImported.mutateAsync(analysisId).catch(() => undefined);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const selectedCount = selected.size;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-[var(--color-divider)] bg-[var(--color-bg-panel)] p-0 shadow-none">
        <header className="flex items-center justify-between border-b border-[var(--color-divider)] px-5 py-4">
          <div>
            <DialogTitle
              className="text-[22px] font-semibold tracking-tight text-[var(--color-text)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Suggested reviews
            </DialogTitle>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-muted)]">
              {imported
                ? 'Imported — new workflows are created paused.'
                : `${bundle.workflows.length} review${bundle.workflows.length === 1 ? '' : 's'} suggested for this repository.`}
            </p>
          </div>
          <Button onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {imported ? (
            <div className="rounded-lg border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-4 py-3 font-mono text-[12px] text-[var(--color-text-2)]">
              {importTemplate.isSuccess ? (
                <>
                  Imported {selectedCount} review{selectedCount === 1 ? '' : 's'}. Find them in
                  your workflow list — they're paused until you review and activate.
                </>
              ) : (
                <>
                  These suggestions were already imported. Find the workflows in your list —
                  they're paused until you review and activate. Re-analyze the repo to generate
                  fresh suggestions.
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {bundle.workflows.map((workflow, i) => (
                <SuggestionCard
                  key={`${workflow.name}-${i}`}
                  workflow={workflow}
                  selected={selected.has(i)}
                  onToggle={() => toggle(i)}
                />
              ))}

              {droppedComponents.length > 0 && (
                <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-dashed border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-4 py-3">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
                    Couldn't analyze
                  </div>
                  {droppedComponents.map((d, i) => (
                    <div key={i} className="font-mono text-[11.5px] text-[var(--color-text-2)]">
                      <code className="text-[var(--color-text)]">{d.component}</code> — {d.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--color-divider)] px-5 py-3">
          {error ? (
            <div className="font-mono text-[11px] text-[var(--color-danger)]">{error}</div>
          ) : (
            <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
              {imported
                ? 'Workflows are created paused — review + activate on the canvas.'
                : `${selectedCount} of ${bundle.workflows.length} selected`}
            </div>
          )}
          {imported ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={importSelected}
              disabled={selectedCount === 0 || importTemplate.isPending}
            >
              {importTemplate.isPending
                ? 'Importing…'
                : `Import ${selectedCount === 1 ? 'review' : `${selectedCount} reviews`}`}
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionCard({
  workflow,
  selected,
  onToggle,
}: {
  workflow: TemplateWorkflow;
  selected: boolean;
  onToggle: () => void;
}) {
  const { what, why } = splitDescription(workflow.description);
  const cadence = cadenceOf(workflow);

  return (
    <label className="flex cursor-pointer gap-3 rounded-lg border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-4 py-3">
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex w-full items-center justify-between gap-3">
          <span className="font-mono text-[13px] font-semibold text-[var(--color-text)]">
            {workflow.name}
          </span>
          {cadence && (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
              <CalendarClock size={12} strokeWidth={1.5} />
              {cadence}
            </span>
          )}
        </div>
        {what && (
          <span className="font-mono text-[11.5px] leading-relaxed text-[var(--color-text-2)]">
            {what}
          </span>
        )}
        {why && (
          <span className="font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            <span className="text-[var(--color-text-2)]">Why:</span> {why}
          </span>
        )}
      </div>
    </label>
  );
}
