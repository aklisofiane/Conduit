import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TriggerConfig } from '@conduit/shared';
import { nodeSize, tokens } from '../../styles/theme.js';
import { Icon } from './Icon.js';

export interface TriggerNodeData extends Record<string, unknown> {
  trigger: TriggerConfig;
  filterCount: number;
}

export function TriggerNode({ data, selected }: NodeProps) {
  const { trigger, filterCount } = data as TriggerNodeData;
  return (
    <div
      className="rounded-[var(--radius)] px-3 py-[10px] transition-all"
      style={{
        width: nodeSize.trigger.width,
        minHeight: nodeSize.trigger.minHeight,
        background: tokens.color.triggerBg,
        border: `1px solid ${selected ? tokens.color.accent : tokens.color.triggerBorder}`,
        boxShadow: selected
          ? `${tokens.shadow.focus}, ${tokens.shadow.node}`
          : tokens.shadow.node,
        color: tokens.color.text,
        fontFamily: tokens.font.mono,
        fontSize: 12,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px]"
          style={{ background: tokens.color.trigger }}
        >
          <Icon name="clock" size={11} color="#FFFFFF" />
        </span>
        <span
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: tokens.color.textMuted }}
        >
          Trigger
        </span>
        <span
          className="ml-auto rounded-[var(--radius-sm)] px-[6px] py-[1px] font-mono text-[9px] uppercase tracking-[0.06em]"
          style={{
            background: tokens.color.pillBg,
            color: tokens.color.text2,
            border: `1px solid ${tokens.color.pillBorder}`,
          }}
        >
          {trigger.platform}
        </span>
      </div>
      <div
        className="mt-[6px] truncate font-medium"
        style={{ color: tokens.color.text }}
      >
        {triggerLabel(trigger)}
      </div>
      {filterCount > 0 && (
        <div
          className="mt-1 font-mono text-[10px]"
          style={{ color: tokens.color.textMuted }}
        >
          {filterCount} filter{filterCount === 1 ? '' : 's'}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  );
}

function triggerLabel(t: TriggerConfig): string {
  switch (t.type) {
    case 'issues':
      return `every ${t.intervalSec}s`;
    case 'pull_requests':
      return `every ${t.intervalSec}s · prs`;
    case 'webhook':
      return t.event;
  }
}
