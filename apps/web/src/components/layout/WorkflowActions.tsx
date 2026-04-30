import { Icon } from '../canvas/Icon.js';

interface WorkflowActionsProps {
  isActive: boolean;
  dirty: boolean;
  saving: boolean;
  running: boolean;
  onSave: () => void;
  onTestRun: () => void;
}

export function WorkflowActions({
  isActive,
  dirty,
  saving,
  running,
  onSave,
  onTestRun,
}: WorkflowActionsProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="pill">
        <span
          className="dot"
          style={{
            background: isActive
              ? 'var(--color-success)'
              : 'var(--color-text-muted)',
          }}
        />
        <span className="text-[var(--color-text-muted)]">workflow</span>
        <span className="text-[var(--color-text)]">
          {isActive ? 'active' : 'paused'}
        </span>
      </span>
      <button
        type="button"
        className="btn"
        onClick={onSave}
        disabled={!dirty || saving}
      >
        {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </button>
      <button
        type="button"
        className="btn primary"
        onClick={onTestRun}
        disabled={running || dirty}
        title={dirty ? 'Save changes before running' : 'Start a manual run'}
      >
        <Icon name="play" size={11} color="currentColor" />
        Test run
      </button>
    </div>
  );
}
