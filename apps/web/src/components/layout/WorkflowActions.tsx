interface WorkflowActionsProps {
  isActive: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}

export function WorkflowActions({
  isActive,
  dirty,
  saving,
  onSave,
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
    </div>
  );
}
