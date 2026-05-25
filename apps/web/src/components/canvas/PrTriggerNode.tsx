import type { NodeProps } from '@xyflow/react';
import { GitPullRequest } from 'lucide-react';
import type { TriggerConfig } from '@conduit/shared';
import { TriggerNodeShell } from './trigger-node-common.js';

export interface PrTriggerNodeData extends Record<string, unknown> {
  trigger: Extract<TriggerConfig, { type: 'pull_requests' }>;
  filterCount: number;
  host?: string;
}

export function PrTriggerNode({ data, selected }: NodeProps) {
  const { trigger, filterCount, host } = data as PrTriggerNodeData;
  const meta = filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? '' : 's'}` : undefined;
  return (
    <TriggerNodeShell
      selected={selected}
      icon={<GitPullRequest size={11} color="#FFFFFF" strokeWidth={1.5} />}
      label="Pull requests"
      detail={`every ${trigger.intervalSec}s`}
      meta={meta}
      platform={trigger.platform}
      host={host}
    />
  );
}
