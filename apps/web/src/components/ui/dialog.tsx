import * as RxDialog from '@radix-ui/react-dialog';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn.js';

/**
 * Dialog — Radix dialog folded into the `ui/` primitive layer. Styling is
 * self-contained Tailwind (no `.dialog-*` globals); see
 * .specs/ui-primitive-layer.md (wave 7).
 */
const dialogOverlayClass = 'fixed inset-0 z-[70] bg-[rgba(11,16,32,0.32)]';

const dialogContentClass = cn(
  'fixed top-1/2 left-1/2 z-[71] -translate-x-1/2 -translate-y-1/2',
  'flex flex-col overflow-hidden outline-none',
  'max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)]',
  'bg-[var(--color-bg-panel)] border border-[var(--color-divider)] rounded-[var(--radius-lg)]',
  'shadow-[0_12px_40px_rgba(11,16,32,0.18),0_2px_8px_rgba(11,16,32,0.08)]',
);

const dialogTitleClass =
  'm-0 font-sans text-[14px] font-semibold text-[var(--color-text)]';

const dialogDescriptionClass =
  'm-0 font-mono text-[11px] text-[var(--color-text-muted)]';

export const Dialog = RxDialog.Root;
export const DialogTrigger = RxDialog.Trigger;
export const DialogClose = RxDialog.Close;

export const DialogOverlay = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxDialog.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <RxDialog.Overlay
      ref={ref}
      className={cn(dialogOverlayClass, className)}
      {...props}
    />
  );
});

interface DialogContentProps
  extends ComponentPropsWithoutRef<typeof RxDialog.Content> {
  showOverlay?: boolean;
}

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  function DialogContent({ className, children, showOverlay = true, ...props }, ref) {
    return (
      <RxDialog.Portal>
        {showOverlay && <DialogOverlay />}
        <RxDialog.Content
          ref={ref}
          className={cn(dialogContentClass, className)}
          {...props}
        >
          {children}
        </RxDialog.Content>
      </RxDialog.Portal>
    );
  },
);

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof RxDialog.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <RxDialog.Title
      ref={ref}
      className={cn(dialogTitleClass, className)}
      {...props}
    />
  );
});

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof RxDialog.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <RxDialog.Description
      ref={ref}
      className={cn(dialogDescriptionClass, className)}
      {...props}
    />
  );
});
