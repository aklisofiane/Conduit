import type { NodeProps } from '@xyflow/react';
import { Clock } from 'lucide-react';
import type { TriggerConfig } from '@conduit/shared';
import { TriggerNodeShell } from './trigger-node-common.js';

export interface CronTriggerNodeData extends Record<string, unknown> {
  trigger: Extract<TriggerConfig, { type: 'cron' }>;
}

export function CronTriggerNode({ data, selected }: NodeProps) {
  const { trigger } = data as CronTriggerNodeData;
  return (
    <TriggerNodeShell
      selected={selected}
      icon={<Clock size={11} color="#FFFFFF" strokeWidth={1.5} />}
      label="Cron"
      detail={trigger.cron}
      meta={`${trigger.branch} · ${trigger.timezone}`}
      platform={trigger.platform}
    />
  );
}
