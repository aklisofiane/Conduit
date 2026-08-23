import * as RxMenu from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn.js';

/**
 * DropdownMenu — Radix menu folded into the `ui/` primitive layer. The styling
 * lives here as cva-style class strings (self-contained Tailwind) rather than
 * the old `.dropdown-*` globals; see .specs/ui-primitive-layer.md (wave 7).
 * `dropdownLabelClass` is shared with `ui/select` (its group headers reuse the
 * same uppercase-mono label).
 */
const dropdownContentClass = cn(
  'z-[60] min-w-[168px] overflow-hidden p-1',
  'bg-[var(--color-bg-panel)] border border-[var(--color-divider)] rounded-[var(--radius)]',
  'shadow-[0_4px_16px_rgba(11,16,32,0.06),0_1px_2px_rgba(11,16,32,0.04)]',
);

const dropdownItemClass = cn(
  'flex items-center gap-2 px-2 py-1.5 select-none cursor-pointer outline-none',
  'font-sans text-small text-[var(--color-text)] rounded-[var(--radius-sm)]',
  'data-[highlighted]:bg-[var(--color-pill-bg)]',
  'data-[disabled]:text-[var(--color-text-muted)] data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed',
);

const dropdownItemDangerClass = cn(
  'text-[var(--color-error)]',
  'data-[highlighted]:bg-[color-mix(in_oklch,var(--color-error)_10%,transparent)]',
);

const dropdownSeparatorClass = 'h-px -mx-1 my-1 bg-[var(--color-divider)]';

export const dropdownLabelClass = cn(
  'px-2 py-1 font-mono text-caption uppercase tracking-[0.06em] text-[var(--color-text-muted)]',
);

export const DropdownMenu = RxMenu.Root;
export const DropdownMenuTrigger = RxMenu.Trigger;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <RxMenu.Portal>
      <RxMenu.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(dropdownContentClass, className)}
        {...props}
      />
    </RxMenu.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.Item> & { tone?: 'default' | 'danger' }
>(function DropdownMenuItem({ className, tone, ...props }, ref) {
  return (
    <RxMenu.Item
      ref={ref}
      className={cn(dropdownItemClass, tone === 'danger' && dropdownItemDangerClass, className)}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <RxMenu.Separator ref={ref} className={cn(dropdownSeparatorClass, className)} {...props} />
  );
});

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return <RxMenu.Label ref={ref} className={cn(dropdownLabelClass, className)} {...props} />;
});
