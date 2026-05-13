import * as RxSelect from '@radix-ui/react-select';
import type { ReactNode } from 'react';
import { Icon } from '../canvas/Icon.js';
import { cn } from '../../lib/cn.js';

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
      <RxSelect.Trigger
        aria-label={ariaLabel}
        className={cn('select-trigger', className)}
      >
        <RxSelect.Value placeholder={placeholder} />
        <RxSelect.Icon className="select-trigger-chevron">
          <Icon name="chevron-down" size={12} />
        </RxSelect.Icon>
      </RxSelect.Trigger>
      <RxSelect.Portal>
        <RxSelect.Content
          position="popper"
          sideOffset={4}
          className="select-content"
        >
          <RxSelect.Viewport className="select-viewport">
            {options.map((item, i) =>
              isGroup(item) ? (
                <RxSelect.Group key={`g-${i}-${item.label}`}>
                  <RxSelect.Label className="dropdown-label">
                    {item.label}
                  </RxSelect.Label>
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
    <RxSelect.Item
      value={option.value}
      disabled={option.disabled}
      className="select-item"
    >
      <RxSelect.ItemText>{option.label}</RxSelect.ItemText>
      <RxSelect.ItemIndicator className="select-item-indicator">
        <Icon name="check" size={12} color="var(--color-accent)" />
      </RxSelect.ItemIndicator>
    </RxSelect.Item>
  );
}
