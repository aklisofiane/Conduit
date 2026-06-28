import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';
import { isCloudHost } from '@conduit/shared/platform';
import type { Platform } from '@conduit/shared/platform';
import { nodeSize } from '../../styles/theme.js';
import { NodeShell, NodeIconTile, NodeTag } from '../ui/node.js';

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
    <NodeShell
      tone="trigger"
      selected={selected}
      // overflow-visible: the original trigger root had no overflow rule, so the
      // right-edge source Handle dot must not be clipped by NodeShell's base
      // overflow-hidden (AgentNode keeps the clip; trigger nodes never had it).
      className="overflow-visible px-3 py-[10px] text-[12px]"
      style={{
        width: nodeSize.trigger.width,
        minHeight: nodeSize.trigger.minHeight,
      }}
    >
      <div className="flex items-center gap-2">
        <NodeIconTile tone="trigger" size="sm">
          {icon}
        </NodeIconTile>
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
          {label}
        </span>
        <NodeTag tone="neutral">{platform}</NodeTag>
      </div>
      {showHost && (
        <div className="mt-[2px] truncate font-mono text-[9px] text-[var(--color-text-muted)]">
          {host}
        </div>
      )}
      <div className="mt-[6px] truncate font-medium">{detail}</div>
      {meta && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
          {meta}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </NodeShell>
  );
}
