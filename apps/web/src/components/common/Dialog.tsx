import * as RxDialog from '@radix-ui/react-dialog';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn.js';

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
      className={cn('dialog-overlay', className)}
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
          className={cn('dialog-content', className)}
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
      className={cn('dialog-title', className)}
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
      className={cn('dialog-description', className)}
      {...props}
    />
  );
});
