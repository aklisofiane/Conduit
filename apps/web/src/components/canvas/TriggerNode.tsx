import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TriggerConfig } from '@conduit/shared';

export interface TriggerNodeData extends Record<string, unknown> {
  trigger: TriggerConfig;
  filterCount: number;
}

export function TriggerNode({ data, selected }: NodeProps) {
  const { trigger, filterCount } = data as TriggerNodeData;
  return (
    <div
      className="flex min-w-[280px] items-center gap-3 rounded-xl border bg-[var(--color-bg-1)] px-3 py-2 shadow-md"
      style={{
        borderColor: selected ? 'rgba(244,244,245,0.15)' : 'var(--color-line)',
      }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] text-[var(--color-text-2)]">
        <GitHubIcon />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="font-mono text-[10.5px] text-[var(--color-text-3)] uppercase tracking-wider">
          {trigger.platform} · {trigger.mode.kind}
        </div>
        <div className="truncate font-mono text-[12px] font-medium text-[var(--color-text)]">
          {trigger.mode.kind === 'webhook'
            ? trigger.mode.event
            : `every ${trigger.mode.intervalSec}s`}
        </div>
      </div>
      {filterCount > 0 && (
        <span className="chip">
          <span className="dot" />
          {filterCount} filter{filterCount === 1 ? '' : 's'}
        </span>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}
