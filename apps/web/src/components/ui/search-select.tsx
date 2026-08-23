import * as Popover from '@radix-ui/react-popover';
import { useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import {
  selectChevronClass,
  selectItemClass,
  selectTriggerClass,
  type SelectOption,
} from './select.js';

/**
 * SearchSelect — Popover-based combobox sharing the trigger + row chrome with
 * `ui/select`. Styling is self-contained Tailwind (no `.search-select-*`
 * globals); see .specs/ui-primitive-layer.md (wave 7). The popover-surface
 * class strings are exported because `CheckboxListPopover` reuses the same
 * search box + list shell.
 */

/** Trigger border treatment while the popover is open (focus-ring look). */
export const searchSelectOpenClass = 'border-[var(--color-accent)] shadow-[var(--shadow-focus)]';

/** Truncating value inside the trigger. */
export const searchSelectValueClass = 'flex-1 min-w-0 text-left truncate';

export const searchSelectPlaceholderClass = 'text-[var(--color-text-muted)]';

/** The floating popover surface — a flex column the search box + list sit in. */
export const searchSelectContentClass = cn(
  'z-[80] w-[var(--radix-popover-trigger-width)] max-h-[260px] flex flex-col overflow-hidden',
  'bg-[var(--color-bg-panel)] border border-[var(--color-divider)] rounded-[var(--radius)]',
  'shadow-[0_4px_16px_rgba(11,16,32,0.06),0_1px_2px_rgba(11,16,32,0.04)]',
);

export const searchSelectInputRowClass =
  'flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--color-divider)]';

export const searchSelectIconClass = 'flex-shrink-0 text-[var(--color-text-muted)]';

export const searchSelectInputClass = cn(
  'w-full border-0 bg-transparent outline-none',
  'font-mono text-small text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
);

export const searchSelectListClass = 'overflow-y-auto p-1';

export const searchSelectEmptyClass =
  'p-2 text-center font-mono text-small text-[var(--color-text-muted)]';

export const searchSelectItemSelectedClass = 'bg-[var(--color-accent-soft)] font-semibold';

interface SearchSelectProps {
  value: string;
  onValueChange: (next: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function SearchSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  ariaLabel,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? options.filter((o) => {
        const text = typeof o.label === 'string' ? o.label : o.value;
        return text.toLowerCase().includes(query.toLowerCase());
      })
    : options;

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Popover.Trigger
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(selectTriggerClass, open && searchSelectOpenClass, className)}
      >
        <span
          className={cn(searchSelectValueClass, !selectedLabel && searchSelectPlaceholderClass)}
        >
          {selectedLabel ?? placeholder}
        </span>
        <span className={cn(selectChevronClass, open && 'rotate-180')}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className={searchSelectContentClass}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className={searchSelectInputRowClass}>
            <Search size={12} strokeWidth={1.5} className={searchSelectIconClass} />
            <input
              ref={inputRef}
              className={searchSelectInputClass}
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className={searchSelectListClass}>
            {filtered.length === 0 && <div className={searchSelectEmptyClass}>No results</div>}
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  selectItemClass,
                  opt.value === value && searchSelectItemSelectedClass,
                )}
                onClick={() => {
                  onValueChange(opt.value);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span>{opt.label}</span>
                {opt.value === value && (
                  <Check size={12} color="var(--color-accent)" strokeWidth={1.5} />
                )}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
