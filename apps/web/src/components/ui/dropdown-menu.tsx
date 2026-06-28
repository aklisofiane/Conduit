import * as RxMenu from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn.js';

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
        className={cn('dropdown-content', className)}
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
      className={cn('dropdown-item', tone === 'danger' && 'is-danger', className)}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <RxMenu.Separator
      ref={ref}
      className={cn('dropdown-separator', className)}
      {...props}
    />
  );
});

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <RxMenu.Label
      ref={ref}
      className={cn('dropdown-label', className)}
      {...props}
    />
  );
});
