import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../canvas/Icon.js';
import { cn } from '../../lib/cn.js';

interface RowActionsMenuProps {
  anchorEl: HTMLElement;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  duplicating?: boolean;
  deleting?: boolean;
}

const MENU_WIDTH = 168;

export function RowActionsMenu({
  anchorEl,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  duplicating,
  deleting,
}: RowActionsMenuProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - MENU_WIDTH),
    });
  }, [anchorEl]);

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

  return createPortal(
    <div
      ref={popRef}
      role="menu"
      aria-label="Workflow actions"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: MENU_WIDTH,
        zIndex: 50,
      }}
      className="flex flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem icon="pencil" label="Rename" onClick={onRename} />
      <MenuItem
        icon="copy"
        label={duplicating ? 'Duplicating…' : 'Duplicate'}
        disabled={duplicating}
        onClick={onDuplicate}
      />
      <div className="my-1 border-t border-[var(--color-divider)]" />
      <MenuItem
        icon="trash"
        label={deleting ? 'Deleting…' : 'Delete'}
        disabled={deleting}
        destructive
        onClick={onDelete}
      />
    </div>,
    document.body,
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        destructive
          ? 'text-[var(--color-error)] hover:bg-[var(--color-pill-bg)]'
          : 'text-[var(--color-text-2)] hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)]',
      )}
    >
      <Icon name={icon} size={12} />
      {label}
    </button>
  );
}
