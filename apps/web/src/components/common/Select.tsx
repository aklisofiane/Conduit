import * as RxSelect from '@radix-ui/react-select';
import type { ReactNode } from 'react';
import { Icon } from '../canvas/Icon.js';
import { cn } from '../../lib/cn.js';

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

interface SelectProps {
  value: string;
  onValueChange: (next: string) => void;
  options: SelectOption[];
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
            {options.map((opt) => (
              <RxSelect.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className="select-item"
              >
                <RxSelect.ItemText>{opt.label}</RxSelect.ItemText>
                <RxSelect.ItemIndicator className="select-item-indicator">
                  <Icon name="check" size={12} color="var(--color-accent)" />
                </RxSelect.ItemIndicator>
              </RxSelect.Item>
            ))}
          </RxSelect.Viewport>
        </RxSelect.Content>
      </RxSelect.Portal>
    </RxSelect.Root>
  );
}
