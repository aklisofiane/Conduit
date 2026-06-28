import { useCallback, useRef, useState, type ReactElement } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '../../lib/cn.js';

/**
 * Card surface for the hover popover. Self-contained Tailwind (no `.info-popover`
 * global); the `info-popover-in` keyframes still live in `globals.css` alongside
 * the other animation primitives. See .specs/ui-primitive-layer.md (wave 7).
 */
const infoPopoverClass = cn(
  'z-[80] w-[312px] p-3.5 font-sans',
  'bg-[var(--color-bg-panel)] border border-[var(--color-divider)] rounded-[var(--radius)]',
  'shadow-[0_4px_16px_rgba(11,16,32,0.06),0_1px_2px_rgba(11,16,32,0.04)]',
  'animate-[info-popover-in_140ms_ease]',
);

/**
 * Wraps an action (typically a button) so that hovering or focusing it reveals
 * an explanatory popover card — the shared "what does this control do?"
 * affordance next to a dense, otherwise-opaque action (e.g. "Analyze repo").
 *
 * The {@link trigger} keeps its own click behaviour: the popover anchors to it
 * (`Popover.Anchor`) and opens purely on hover/focus, so clicking the button
 * still performs its real action instead of toggling the card. Opens on
 * keyboard focus too, so it isn't hover-only; a short close delay lets the
 * pointer travel from the trigger onto the card without it dismissing.
 *
 * Callers own the card body via {@link children}.
 */
export function InfoPopover({
  label,
  trigger,
  children,
  align = 'end',
  className,
}: {
  /** Accessible name for the popover, e.g. "What 'Analyze repo' does". */
  label: string;
  /** The element the card explains — receives hover/focus handlers. */
  trigger: ReactElement;
  children: ReactElement | ReactElement[];
  align?: Popover.PopoverContentProps['align'];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  // Brief grace period so moving the pointer from the trigger to the card
  // (which is portaled, with a gap for the arrow) doesn't dismiss it.
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor
        asChild
        onPointerEnter={openNow}
        onPointerLeave={scheduleClose}
        onFocus={openNow}
        onBlur={scheduleClose}
      >
        {trigger}
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          aria-label={label}
          sideOffset={6}
          align={align}
          collisionPadding={12}
          className={cn(infoPopoverClass, className)}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          // Hover/focus-opened — don't steal focus from the page.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {children}
          <Popover.Arrow className="fill-[var(--color-bg-panel)]" width={11} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
