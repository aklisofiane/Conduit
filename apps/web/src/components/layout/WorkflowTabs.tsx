import { cn } from '../../lib/cn.js';

export type WorkflowTabId = 'build' | 'runs' | 'history';

interface WorkflowTabsProps {
  active: WorkflowTabId;
  onChange?: (id: WorkflowTabId) => void;
}

interface TabDef {
  id: WorkflowTabId;
  label: string;
  enabled: boolean;
}

const TABS: TabDef[] = [
  { id: 'build', label: 'Build', enabled: true },
  { id: 'runs', label: 'Runs', enabled: false },
  { id: 'history', label: 'History', enabled: false },
];

export function WorkflowTabs({ active, onChange }: WorkflowTabsProps) {
  return (
    <div className="flex items-center gap-1">
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            disabled={!t.enabled}
            title={t.enabled ? undefined : 'Coming soon'}
            onClick={() => t.enabled && onChange?.(t.id)}
            className={cn(
              'h-7 rounded-[var(--radius)] border px-3 font-sans text-[12px] transition-colors',
              isActive
                ? 'border-[var(--color-divider)] bg-[var(--color-bg)] font-medium text-[var(--color-text)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              !t.enabled && 'cursor-not-allowed opacity-60 hover:text-[var(--color-text-muted)]',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
