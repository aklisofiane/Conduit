import type { PointerEvent as ReactPointerEvent } from 'react';

interface ResizeHandleProps {
  onPointerDown: (event: ReactPointerEvent) => void;
}

export function ResizeHandle({ onPointerDown }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      onPointerDown={onPointerDown}
      className="group absolute left-0 top-0 z-10 h-full w-[6px] -translate-x-1/2 cursor-col-resize touch-none"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[var(--color-accent)] group-active:bg-[var(--color-accent)]" />
    </div>
  );
}
