import { useState } from 'react';
import { CircleDot, Clock, GitPullRequest } from 'lucide-react';
import { useConnections } from '../../api/hooks.js';
import { scopeSummary } from '../../lib/connection.js';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.js';
import { Select } from '../ui/select.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { SelectableCard } from '../ui/selectable-card.js';
import type { PaletteTriggerType } from '../canvas/NodePalette.js';

interface CreateWorkflowDialogProps {
  onClose: () => void;
  onCreate: (
    name: string,
    triggerType: PaletteTriggerType,
    connectionId?: string,
    platform?: 'github' | 'gitlab',
  ) => void;
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
    label: 'Schedule',
    description: 'Run on a time-based schedule',
    icon: <Clock size={14} color="#FFFFFF" strokeWidth={1.5} />,
  },
];

export function CreateWorkflowDialog({ onClose, onCreate, isPending }: CreateWorkflowDialogProps) {
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<PaletteTriggerType | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const { data: connections = [] } = useConnections();

  const repoConnections = connections.filter(
    (c) => c.scope.kind === 'github_repo' || c.scope.kind === 'gitlab_project',
  );

  const canCreate = name.trim().length > 0 && triggerType !== null;

  const handleCreate = () => {
    if (!canCreate || !triggerType) return;
    const conn = repoConnections.find((c) => c.id === connectionId);
    const platform =
      conn?.credential.platform === 'GITLAB' ? ('gitlab' as const) : ('github' as const);
    onCreate(
      name.trim(),
      triggerType,
      connectionId || undefined,
      connectionId ? platform : undefined,
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !isPending) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-[480px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-[var(--color-divider)] bg-[var(--color-bg-panel)] p-0 shadow-none">
        <header className="flex items-center justify-between border-b border-[var(--color-divider)] px-5 py-4">
          <div>
            <DialogTitle
              className="text-[22px] font-semibold tracking-tight text-[var(--color-text)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              New workflow
            </DialogTitle>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-muted)]">
              Name it and pick a trigger to get started.
            </p>
          </div>
          <Button onClick={onClose} aria-label="Close" disabled={isPending}>
            ✕
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Name
            </span>
            <Input
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
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Trigger
            </span>
            <div className="mt-1.5 flex flex-col gap-[6px]">
              {TRIGGER_OPTIONS.map((opt) => (
                <SelectableCard
                  key={opt.type}
                  tone="accent"
                  selected={triggerType === opt.type}
                  onClick={() => setTriggerType(opt.type)}
                  className="flex items-center gap-3 rounded-[var(--radius)] px-3 py-2.5"
                >
                  <span
                    className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-[5px]"
                    style={{
                      background:
                        triggerType === opt.type ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    }}
                  >
                    {opt.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[var(--color-text)]">
                      {opt.label}
                    </span>
                    <span className="block font-mono text-[11px] text-[var(--color-text-muted)]">
                      {opt.description}
                    </span>
                  </span>
                </SelectableCard>
              ))}
            </div>
          </div>

          {triggerType && repoConnections.length > 0 && (
            <div className="mt-4">
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Connection <span className="normal-case tracking-normal">(optional)</span>
              </span>
              <div className="mt-1.5">
                <Select
                  ariaLabel="Connection"
                  value={connectionId}
                  onValueChange={setConnectionId}
                  placeholder="— pick a connection —"
                  options={repoConnections.map((c) => ({
                    value: c.id,
                    label: `${c.name} · ${scopeSummary(c.scope) ?? c.credential.platform.toLowerCase()}`,
                  }))}
                />
              </div>
              <p className="mt-1 font-mono text-[10.5px] text-[var(--color-text-muted)]">
                Pre-wires the trigger to this repo. You can change it on the canvas.
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end border-t border-[var(--color-divider)] px-5 py-3">
          <div className="flex items-center gap-2">
            <Button onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreate} disabled={!canCreate || isPending}>
              {isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
