import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ResizeHandle } from './ResizeHandle.js';

interface InspectorShellProps {
  width: number;
  onResizeStart: (event: ReactPointerEvent) => void;
  children: ReactNode;
}

export function InspectorShell({ width, onResizeStart, children }: InspectorShellProps) {
  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-[var(--color-divider)] bg-[var(--color-bg-panel)]"
      style={{ width }}
    >
      <ResizeHandle onPointerDown={onResizeStart} />
      {children}
    </aside>
  );
}
