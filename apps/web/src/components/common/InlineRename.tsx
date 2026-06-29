import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

interface InlineRenameProps {
  initial: string;
  saving: boolean;
  onCommit: (next: string) => void;
  onCancel: () => void;
  maxLength?: number;
  className?: string;
}

/**
 * Single-line inline rename input. Auto-focus + select on mount; Enter
 * commits, Escape cancels, blur commits. Used by the canvas header pill
 * and the workflow row actions menu.
 */
export function InlineRename({
  initial,
  saving,
  onCommit,
  onCancel,
  maxLength = 120,
  className,
}: InlineRenameProps) {
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
      maxLength={maxLength}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onCommit(value)}
      onClick={(e) => e.stopPropagation()}
      className={
        className ??
        'w-full bg-transparent px-1 py-[3px] font-mono text-base text-[var(--color-text)] outline-none'
      }
    />
  );
}
