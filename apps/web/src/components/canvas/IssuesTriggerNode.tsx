import type { NodeProps } from '@xyflow/react';
import { CircleDot } from 'lucide-react';
import type { TriggerConfig } from '@conduit/shared';
import { TriggerNodeShell } from './trigger-node-common.js';

export interface IssuesTriggerNodeData extends Record<string, unknown> {
  trigger: Extract<TriggerConfig, { type: 'issues' }>;
  filterCount: number;
  host?: string;
}

export function IssuesTriggerNode({ data, selected }: NodeProps) {
  const { trigger, filterCount, host } = data as IssuesTriggerNodeData;
  const detail = trigger.boardConnectionId
    ? `board · every ${trigger.intervalSec}s`
    : `repo issues · every ${trigger.intervalSec}s`;
  const meta = filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? '' : 's'}` : undefined;
  return (
    <TriggerNodeShell
      selected={selected}
      icon={<CircleDot size={11} color="#FFFFFF" strokeWidth={1.5} />}
      label="Issues"
      detail={detail}
      meta={meta}
      platform={trigger.platform}
      host={host}
    />
  );
}
