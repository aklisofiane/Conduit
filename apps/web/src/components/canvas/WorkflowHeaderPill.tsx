import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  useCreateWorkflow,
  useUpdateWorkflow,
  useWorkflow,
  useWorkflows,
} from '../../api/hooks.js';
import type { WorkflowRow } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { relativeFromNow } from '../../lib/time.js';
import { Icon } from './Icon.js';

const NAME_MAX_LENGTH = 120;

interface WorkflowHeaderPillProps {
  workflowId: string;
}

export function WorkflowHeaderPill({ workflowId }: WorkflowHeaderPillProps) {
  const { data: wf } = useWorkflow(workflowId);
  const update = useUpdateWorkflow(workflowId);

  const [mode, setMode] = useState<'view' | 'rename'>('view');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const handleRenameCommit = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      setMode('view');
      if (!trimmed || trimmed === wf?.name) return;
      if (trimmed.length > NAME_MAX_LENGTH) return;
      update.mutate(
        { name: trimmed },
        {
          onError: (err) =>
            alert(err instanceof Error ? err.message : String(err)),
        },
      );
    },
    [update, wf?.name],
  );

  const handleRenameCancel = useCallback(() => setMode('view'), []);

  const togglePopover = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
    setPopoverOpen((open) => !open);
  }, []);

  const closePopover = useCallback(() => setPopoverOpen(false), []);

  const name = wf?.name ?? 'workflow';

  return (
    <>
      <div
        ref={anchorRef}
        className={cn(
          'pointer-events-auto inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] font-mono text-[11px]',
          mode === 'rename' ? 'px-1' : '',
        )}
      >
        {mode === 'rename' ? (
          <RenameInput
            initial={name}
            saving={update.isPending}
            onCommit={handleRenameCommit}
            onCancel={handleRenameCancel}
          />
        ) : (
          <>
            <button
              type="button"
              title={name}
              onClick={() => setMode('rename')}
              className="max-w-[260px] truncate px-2 py-[3px] text-left text-[var(--color-text-2)] hover:text-[var(--color-text)]"
            >
              {name}
            </button>
            <button
              type="button"
              aria-label="Switch workflow"
              onMouseDown={togglePopover}
              className={cn(
                'flex h-full items-center border-l border-[var(--color-divider)] px-1.5 py-[3px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]',
                popoverOpen && 'text-[var(--color-text)]',
              )}
            >
              <Icon name="chevron-down" size={12} />
            </button>
          </>
        )}
      </div>

      {popoverOpen && anchorRef.current && (
        <SwitcherPopover
          anchorEl={anchorRef.current}
          currentId={workflowId}
          onClose={closePopover}
        />
      )}
    </>
  );
}

interface RenameInputProps {
  initial: string;
  saving: boolean;
  onCommit: (next: string) => void;
  onCancel: () => void;
}

function RenameInput({ initial, saving, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      value={value}
      maxLength={NAME_MAX_LENGTH}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onCommit(value)}
      className="w-[200px] min-w-[120px] bg-transparent px-1 py-[3px] font-mono text-[11px] text-[var(--color-text)] outline-none"
    />
  );
}

interface SwitcherPopoverProps {
  anchorEl: HTMLElement;
  currentId: string;
  onClose: () => void;
}

function SwitcherPopover({ anchorEl, currentId, onClose }: SwitcherPopoverProps) {
  const { data: rows = [], isLoading } = useWorkflows();
  const create = useCreateWorkflow();
  const navigate = useNavigate();
  const popRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [position, setPosition] = useState(() => {
    const rect = anchorEl.getBoundingClientRect();
    return { top: rect.bottom + 6, left: rect.left };
  });

  useLayoutEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    setPosition({ top: rect.bottom + 6, left: rect.left });
  }, [anchorEl]);

  useEffect(() => {
    filterRef.current?.focus();
  }, []);

  const others = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => r.id !== currentId)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [rows, currentId, query]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, others.length - 1)));
  }, [others.length]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorEl.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorEl, onClose]);

  const handleSwitch = (id: string) => {
    onClose();
    navigate(`/workflows/${id}`);
  };

  const handleNew = async () => {
    try {
      const created = await create.mutateAsync({ name: 'Untitled workflow' });
      onClose();
      navigate(`/workflows/${created.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (others.length === 0) return;
      setCursor((c) => Math.min(others.length - 1, c + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (others.length === 0) return;
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (e.key === 'Enter') {
      const target = others[cursor];
      if (target) {
        e.preventDefault();
        handleSwitch(target.id);
      }
    }
  };

  const stop = (e: ReactMouseEvent | React.WheelEvent | React.PointerEvent) =>
    e.stopPropagation();

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label="Switch workflow"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 50,
      }}
      className="flex w-[280px] flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
      onKeyDown={handleKeyDown}
      onMouseDown={stop}
      onPointerDown={stop}
      onWheel={stop}
    >
      <div className="border-b border-[var(--color-divider)] p-2">
        <input
          ref={filterRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder="Filter workflows…"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[11px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-text-muted)]"
        />
      </div>

      <div className="max-h-[320px] overflow-y-auto">
        {isLoading && rows.length === 0 ? (
          <EmptyRow text="Loading…" />
        ) : others.length === 0 ? (
          <EmptyRow text={query ? 'No matches' : 'No other workflows'} />
        ) : (
          others.map((row, i) => (
            <SwitcherRow
              key={row.id}
              row={row}
              highlighted={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => handleSwitch(row.id)}
            />
          ))
        )}
      </div>

      <div className="border-t border-[var(--color-divider)]">
        <button
          type="button"
          onClick={handleNew}
          disabled={create.isPending}
          className="flex w-full items-center gap-2 px-3 py-2 font-mono text-[11px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="plus" size={12} />
          {create.isPending ? 'Creating…' : 'New workflow'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function SwitcherRow({
  row,
  highlighted,
  onMouseEnter,
  onClick,
}: {
  row: WorkflowRow;
  highlighted: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left font-mono text-[11px] transition-colors',
        highlighted
          ? 'bg-[var(--color-pill-bg)] text-[var(--color-text)]'
          : 'text-[var(--color-text-2)] hover:text-[var(--color-text)]',
      )}
    >
      <span className="min-w-0 flex-1 truncate" title={row.name}>
        {row.name}
      </span>
      <span className="shrink-0 text-[var(--color-text-muted)]">
        {relativeFromNow(row.updatedAt)}
      </span>
    </button>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-3 py-3 font-mono text-[11px] text-[var(--color-text-muted)]">
      {text}
    </div>
  );
}
