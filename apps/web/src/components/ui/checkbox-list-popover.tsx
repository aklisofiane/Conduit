import { useMemo, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Checkbox } from './checkbox.js';
import { selectChevronClass, selectItemClass, selectTriggerClass } from './select.js';
import {
  searchSelectContentClass,
  searchSelectEmptyClass,
  searchSelectIconClass,
  searchSelectInputClass,
  searchSelectInputRowClass,
  searchSelectItemSelectedClass,
  searchSelectListClass,
  searchSelectOpenClass,
  searchSelectValueClass,
} from './search-select.js';

/**
 * Searchable multi-select popover with a checkbox list — the shared shell behind
 * the skill picker and the MCP tool allow-list. Owns the popover open/query
 * state, search filtering, and the checkbox-row markup (same `search-select-*`
 * classes as {@link SearchSelect}); callers own the selection model and read
 * each item's id/label/description through accessors.
 *
 * Items are filtered against their label + description by substring match.
 * Optionally sectioned via `groupItems` — each group renders a header with an
 * "all" / "none" toggle, and the grouping callback is responsible for dropping
 * empty groups. When `groupItems` is omitted the list is flat and an optional
 * `selectAll` row is rendered above it (hidden while searching).
 */
interface CheckboxListPopoverProps<T> {
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  getDescription?: (item: T) => string | undefined;
  /** Ids currently selected — drives the checkbox + selected-row styling. */
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  /** Toggle every id in the list at once (used by group + select-all rows). */
  onToggleMany: (ids: string[], select: boolean) => void;
  /** Rendered inside the trigger; typically a "N of M" summary. */
  triggerLabel: ReactNode;
  /** Extra classes for the trigger (e.g. `w-full` vs `flex-1`). */
  triggerClassName?: string;
  placeholder: string;
  emptyLabel: string;
  maxHeight: number;
  /**
   * Sections the (already search-filtered) items. Groups render in order with a
   * per-group header + all/none toggle; the callback must drop empty groups.
   * Omit for a flat list.
   */
  groupItems?: (items: T[]) => CheckboxListGroup<T>[];
  /** Flat-list only: a "select all" affordance shown above the list. */
  selectAll?: { checked: boolean; onToggle: () => void; label: string };
}

export interface CheckboxListGroup<T> {
  /** Stable key + header text. */
  name: string;
  /** Secondary header text, appended after a `·`. */
  meta?: string;
  items: T[];
}

export function CheckboxListPopover<T>({
  items,
  getId,
  getLabel,
  getDescription,
  selectedIds,
  onToggle,
  onToggleMany,
  triggerLabel,
  triggerClassName,
  placeholder,
  emptyLabel,
  maxHeight,
  groupItems,
  selectAll,
}: CheckboxListPopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? items.filter(
            (it) =>
              getLabel(it).toLowerCase().includes(q) ||
              (getDescription?.(it)?.toLowerCase().includes(q) ?? false),
          )
        : items,
    [items, q, getLabel, getDescription],
  );
  const groups = useMemo(() => (groupItems ? groupItems(filtered) : null), [groupItems, filtered]);

  const renderRow = (item: T) => {
    const id = getId(item);
    return (
      <CheckboxRow
        key={id}
        label={getLabel(item)}
        description={getDescription?.(item)}
        checked={selectedIds.has(id)}
        onToggle={() => onToggle(id)}
      />
    );
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Popover.Trigger
        className={cn(selectTriggerClass, triggerClassName, open && searchSelectOpenClass)}
      >
        <span className={cn(searchSelectValueClass, 'font-mono text-small')}>{triggerLabel}</span>
        <span className={cn(selectChevronClass, open && 'rotate-180')}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className={searchSelectContentClass}
          style={{ maxHeight }}
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
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {selectAll && !query && (
            <div className="flex items-center justify-between border-b border-[var(--color-divider)] px-2 py-1.5">
              <label className="flex items-center gap-2 font-mono text-small text-[var(--color-text-muted)]">
                <Checkbox checked={selectAll.checked} onCheckedChange={selectAll.onToggle} />
                {selectAll.label}
              </label>
            </div>
          )}

          <div className={searchSelectListClass}>
            {(groups ? groups.length === 0 : filtered.length === 0) && (
              <div className={searchSelectEmptyClass}>{emptyLabel}</div>
            )}
            {groups
              ? groups.map((group) => {
                  const ids = group.items.map(getId);
                  const allSelected = ids.every((id) => selectedIds.has(id));
                  return (
                    <div key={group.name}>
                      <div className="flex items-center justify-between px-2 pb-1 pt-2">
                        <div className="min-w-0 truncate font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
                          {group.name}
                          {group.meta && (
                            <span className="text-[var(--color-text-muted)]"> · {group.meta}</span>
                          )}
                        </div>
                        <button
                          className="flex-shrink-0 font-mono text-caption text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                          onClick={() => onToggleMany(ids, !allSelected)}
                        >
                          {allSelected ? 'none' : 'all'}
                        </button>
                      </div>
                      {group.items.map(renderRow)}
                    </div>
                  );
                })
              : filtered.map(renderRow)}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CheckboxRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        selectItemClass,
        'flex items-start gap-2',
        checked && searchSelectItemSelectedClass,
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-small">{label}</div>
        {description && (
          <div className="truncate font-mono text-caption text-[var(--color-text-muted)]">
            {description}
          </div>
        )}
      </div>
    </label>
  );
}
