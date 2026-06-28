import { Download } from 'lucide-react';
import { Badge, BadgeDot } from '../ui/badge.js';
import { Button } from '../ui/button.js';

interface WorkflowActionsProps {
  isActive: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onExport: () => void;
}

export function WorkflowActions({
  isActive,
  dirty,
  saving,
  onSave,
  onExport,
}: WorkflowActionsProps) {
  return (
    <div className="flex items-center gap-3">
      <Badge>
        <BadgeDot tone={isActive ? 'success' : 'muted'} />
        <span className="text-[var(--color-text-muted)]">workflow</span>
        <span className="text-[var(--color-text)]">
          {isActive ? 'active' : 'paused'}
        </span>
      </Badge>
      <Button
        type="button"
        onClick={onExport}
        title="Export this workflow as a shareable template JSON"
      >
        <Download size={12} strokeWidth={1.5} />
        Export
      </Button>
      <Button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
      >
        {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </Button>
    </div>
  );
}
