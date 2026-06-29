import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js';

export type WorkflowTabId = 'build' | 'runs';

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
  { id: 'build', label: 'Canvas', enabled: true },
  { id: 'runs', label: 'Runs', enabled: true },
];

export function WorkflowTabs({ active, onChange }: WorkflowTabsProps) {
  return (
    <ToggleGroup
      type="single"
      value={active}
      onValueChange={(v) => v && onChange?.(v as WorkflowTabId)}
      variant="outline"
      aria-label="Workflow view"
    >
      {TABS.map((t) => (
        <ToggleGroupItem
          key={t.id}
          value={t.id}
          disabled={!t.enabled}
          title={t.enabled ? undefined : 'Coming soon'}
          className="px-3 font-sans text-[12px]"
        >
          {t.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
