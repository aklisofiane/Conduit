import { useState } from 'react';
import { CircleDot, Clock, GitPullRequest } from 'lucide-react';
import { Dialog, DialogContent } from '../common/Dialog.js';
import type { PaletteTriggerType } from '../canvas/NodePalette.js';

interface CreateWorkflowDialogProps {
  onClose: () => void;
  onCreate: (name: string, triggerType: PaletteTriggerType) => void;
  isPending: boolean;
}

const TRIGGER_OPTIONS: Array<{
  type: PaletteTriggerType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    type: 'issues',
    label: 'Issues',
    description: 'React to new or updated GitHub issues',
    icon: <CircleDot size={14} color="#FFFFFF" strokeWidth={1.5} />,
  },
  {
    type: 'pull_requests',
    label: 'Pull requests',
    description: 'React to new or updated pull requests',
    icon: <GitPullRequest size={14} color="#FFFFFF" strokeWidth={1.5} />,
  },
  {
    type: 'cron',
    label: 'Cron',
    description: 'Run on a time-based schedule',
    icon: <Clock size={14} color="#FFFFFF" strokeWidth={1.5} />,
  },
];

export function CreateWorkflowDialog({
  onClose,
  onCreate,
  isPending,
}: CreateWorkflowDialogProps) {
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<PaletteTriggerType | null>(
    null,
  );

  const canCreate = name.trim().length > 0 && triggerType !== null;

  const handleCreate = () => {
    if (!canCreate || !triggerType) return;
    onCreate(name.trim(), triggerType);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !isPending) onClose();
      }}
    >
      <DialogContent
        aria-label="Create a new workflow"
        className="flex max-h-[85vh] w-[480px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-1)] p-0 shadow-none"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h2
              className="text-[22px] font-semibold tracking-tight text-[var(--color-text)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              New workflow
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-3)]">
              Name it and pick a trigger to get started.
            </p>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close" disabled={isPending}>
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
              Name
            </span>
            <input
              className="field-input"
              value={name}
              placeholder="My workflow"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) handleCreate();
              }}
            />
          </label>

          <div className="mt-4">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
              Trigger
            </span>
            <div className="mt-1.5 flex flex-col gap-[6px]">
              {TRIGGER_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setTriggerType(opt.type)}
                  className="flex w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2.5 text-left transition-colors"
                  style={{
                    borderColor:
                      triggerType === opt.type
                        ? 'var(--color-primary)'
                        : 'var(--color-divider)',
                    background:
                      triggerType === opt.type
                        ? 'var(--color-primary-soft, oklch(0.95 0.03 250))'
                        : 'var(--color-bg)',
                    boxShadow:
                      triggerType === opt.type
                        ? '0 0 0 1px var(--color-primary)'
                        : 'none',
                  }}
                >
                  <span
                    className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-[5px]"
                    style={{
                      background:
                        triggerType === opt.type
                          ? 'var(--color-primary)'
                          : 'var(--color-text-3)',
                    }}
                  >
                    {opt.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[var(--color-text)]">
                      {opt.label}
                    </span>
                    <span className="block font-mono text-[11px] text-[var(--color-text-3)]">
                      {opt.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end border-t border-[var(--color-line)] px-5 py-3">
          <div className="flex items-center gap-2">
            <button className="btn" onClick={onClose} disabled={isPending}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={handleCreate}
              disabled={!canCreate || isPending}
            >
              {isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
