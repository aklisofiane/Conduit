import { useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Clock } from 'lucide-react';
import type { TriggerConfig } from '@conduit/shared';
import { formatCadence } from '../../lib/cron.js';
import { TriggerNodeShell } from './trigger-node-common.js';

export interface CronTriggerNodeData extends Record<string, unknown> {
  trigger: Extract<TriggerConfig, { type: 'cron' }>;
  host?: string;
}

export function CronTriggerNode({ data, selected }: NodeProps) {
  const { trigger, host } = data as CronTriggerNodeData;
  const detail = useMemo(() => formatCadence(trigger.cron), [trigger.cron]);
  return (
    <TriggerNodeShell
      selected={selected}
      icon={<Clock size={11} color="#FFFFFF" strokeWidth={1.5} />}
      label="Schedule"
      detail={detail}
      meta={`${trigger.branch} · ${trigger.timezone}`}
      platform={trigger.platform}
      host={host}
    />
  );
}
