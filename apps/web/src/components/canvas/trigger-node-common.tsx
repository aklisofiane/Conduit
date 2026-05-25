import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';
import { isCloudHost } from '@conduit/shared/platform';
import type { Platform } from '@conduit/shared/platform';
import { nodeSize, tokens } from '../../styles/theme.js';

/**
 * Shared chrome for the typed trigger nodes (`IssuesTriggerNode`,
 * `PrTriggerNode`, `CronTriggerNode`). Each typed node just supplies its
 * own icon, label, and detail line; selection, sizing, and the source
 * handle live here so the three nodes stay visually consistent.
 */
export function TriggerNodeShell({
  selected,
  icon,
  label,
  detail,
  meta,
  platform,
  host,
}: {
  selected: boolean | undefined;
  icon: ReactNode;
  label: string;
  detail: string;
  meta?: string;
  platform: string;
  host?: string;
}) {
  const showHost =
    host != null && !isCloudHost(platform.toUpperCase() as Platform, host);
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
          {icon}
        </span>
        <span
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: tokens.color.textMuted }}
        >
          {label}
        </span>
        <span
          className="ml-auto rounded-[var(--radius-sm)] px-[6px] py-[1px] font-mono text-[9px] uppercase tracking-[0.06em]"
          style={{
            background: tokens.color.pillBg,
            color: tokens.color.text2,
            border: `1px solid ${tokens.color.pillBorder}`,
          }}
        >
          {platform}
        </span>
      </div>
      {showHost && (
        <div
          className="mt-[2px] truncate font-mono text-[9px]"
          style={{ color: tokens.color.textMuted }}
        >
          {host}
        </div>
      )}
      <div
        className="mt-[6px] truncate font-medium"
        style={{ color: tokens.color.text }}
      >
        {detail}
      </div>
      {meta && (
        <div
          className="mt-1 truncate font-mono text-[10px]"
          style={{ color: tokens.color.textMuted }}
        >
          {meta}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  );
}
