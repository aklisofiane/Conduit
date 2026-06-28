import * as Popover from '@radix-ui/react-popover';
import { useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import type { SelectOption } from './select.js';

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
        className={cn('select-trigger', open && 'search-select-open', className)}
      >
        <span className={cn('search-select-value', !selectedLabel && 'search-select-placeholder')}>
          {selectedLabel ?? placeholder}
        </span>
        <span className={cn('select-trigger-chevron', open && 'search-select-chevron-open')}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className="search-select-content"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="search-select-input-row">
            <Search size={12} strokeWidth={1.5} className="search-select-icon" />
            <input
              ref={inputRef}
              className="search-select-input"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="search-select-list">
            {filtered.length === 0 && (
              <div className="search-select-empty">No results</div>
            )}
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={cn('select-item', opt.value === value && 'search-select-item-selected')}
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
