import { useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Clock } from 'lucide-react';
import cronstrue from 'cronstrue';
import type { TriggerConfig } from '@conduit/shared';
import { TriggerNodeShell } from './trigger-node-common.js';

export interface CronTriggerNodeData extends Record<string, unknown> {
  trigger: Extract<TriggerConfig, { type: 'cron' }>;
}

function describeCron(cron: string): string {
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: true });
  } catch {
    return cron;
  }
}

export function CronTriggerNode({ data, selected }: NodeProps) {
  const { trigger } = data as CronTriggerNodeData;
  const detail = useMemo(() => describeCron(trigger.cron), [trigger.cron]);
  return (
    <TriggerNodeShell
      selected={selected}
      icon={<Clock size={11} color="#FFFFFF" strokeWidth={1.5} />}
      label="Schedule"
      detail={detail}
      meta={`${trigger.branch} · ${trigger.timezone}`}
      platform={trigger.platform}
    />
  );
}
