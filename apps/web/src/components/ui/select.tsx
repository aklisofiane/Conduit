import * as RxSelect from '@radix-ui/react-select';
import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { dropdownLabelClass } from './dropdown-menu.js';

/**
 * Select — Radix-backed select in the `ui/` primitive layer. Styling is
 * self-contained Tailwind (no `.select-*` globals); see
 * .specs/ui-primitive-layer.md (wave 7). The trigger / chevron / item / value
 * class strings are exported because the Popover-based `SearchSelect` and
 * `CheckboxListPopover` reuse the same trigger + row chrome.
 */

/** The shared trigger button — a 30px-tall bordered field with a chevron. */
export const selectTriggerClass = cn(
  'group inline-flex w-full min-w-0 h-[30px] items-center justify-between gap-2 px-2.5',
  'bg-[var(--color-bg)] border border-[var(--color-divider)] rounded-[var(--radius)]',
  'font-mono text-small text-[var(--color-text)] cursor-pointer outline-none',
  'transition-[border-color,box-shadow] duration-[120ms] ease-[ease]',
  'enabled:hover:border-[var(--color-text-muted)]',
  'focus-visible:border-[var(--color-accent)] focus-visible:shadow-[var(--shadow-focus)]',
  'data-[state=open]:border-[var(--color-accent)] data-[state=open]:shadow-[var(--shadow-focus)]',
  'data-[placeholder]:text-[var(--color-text-muted)]',
  'disabled:opacity-60 disabled:cursor-not-allowed',
);

/** The trailing chevron. Callers add the open-state `rotate-180` themselves. */
export const selectChevronClass = cn(
  'inline-flex text-[var(--color-text-muted)] transition-transform duration-150 ease-[ease]',
);

/**
 * Truncating wrapper for the trigger label. `RxSelect.Value` drops its own
 * `className` (it spreads only the non-className rest props onto its span), so
 * the ellipsis treatment has to live on a span we own around it.
 */
export const selectValueClass = 'block flex-1 min-w-0 text-left truncate';

/** A row in the listbox — Radix data-state drives highlight/checked/disabled. */
export const selectItemClass = cn(
  'relative flex items-center justify-between gap-2 px-2 py-1.5 select-none cursor-pointer outline-none',
  'font-mono text-small text-[var(--color-text)] rounded-[var(--radius-sm)]',
  'data-[highlighted]:bg-[var(--color-pill-bg)]',
  'data-[state=checked]:bg-[var(--color-accent-soft)] data-[state=checked]:font-semibold',
  'data-[disabled]:text-[var(--color-text-muted)] data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed',
);

const selectContentClass = cn(
  'z-[80] min-w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)] overflow-hidden',
  'bg-[var(--color-bg-panel)] border border-[var(--color-divider)] rounded-[var(--radius)]',
  'shadow-[0_4px_16px_rgba(11,16,32,0.06),0_1px_2px_rgba(11,16,32,0.04)]',
);

const selectItemIndicatorClass = 'inline-flex items-center text-[var(--color-accent)]';

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectGroup = {
  label: string;
  options: SelectOption[];
};

export type SelectItem = SelectOption | SelectGroup;

function isGroup(item: SelectItem): item is SelectGroup {
  return 'options' in item;
}

interface SelectProps {
  value: string;
  onValueChange: (next: string) => void;
  options: SelectItem[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  ariaLabel,
}: SelectProps) {
  return (
    <RxSelect.Root
      value={value === '' ? undefined : value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <RxSelect.Trigger aria-label={ariaLabel} className={cn(selectTriggerClass, className)}>
        <span className={selectValueClass}>
          <RxSelect.Value placeholder={placeholder} />
        </span>
        <RxSelect.Icon className={cn(selectChevronClass, 'group-data-[state=open]:rotate-180')}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </RxSelect.Icon>
      </RxSelect.Trigger>
      <RxSelect.Portal>
        <RxSelect.Content position="popper" sideOffset={4} className={selectContentClass}>
          <RxSelect.Viewport className="p-1">
            {options.map((item, i) =>
              isGroup(item) ? (
                <RxSelect.Group key={`g-${i}-${item.label}`}>
                  <RxSelect.Label className={dropdownLabelClass}>{item.label}</RxSelect.Label>
                  {item.options.map((opt) => (
                    <SelectItemRow key={opt.value} option={opt} />
                  ))}
                </RxSelect.Group>
              ) : (
                <SelectItemRow key={item.value} option={item} />
              ),
            )}
          </RxSelect.Viewport>
        </RxSelect.Content>
      </RxSelect.Portal>
    </RxSelect.Root>
  );
}

function SelectItemRow({ option }: { option: SelectOption }) {
  return (
    <RxSelect.Item value={option.value} disabled={option.disabled} className={selectItemClass}>
      <RxSelect.ItemText>{option.label}</RxSelect.ItemText>
      <RxSelect.ItemIndicator className={selectItemIndicatorClass}>
        <Check size={12} color="var(--color-accent)" strokeWidth={1.5} />
      </RxSelect.ItemIndicator>
    </RxSelect.Item>
  );
}
