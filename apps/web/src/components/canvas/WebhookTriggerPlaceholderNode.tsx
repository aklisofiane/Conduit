import type { NodeProps } from '@xyflow/react';
import { Webhook } from 'lucide-react';
import type { TriggerConfig } from '@conduit/shared';
import { TriggerNodeShell } from './trigger-node-common.js';

export interface WebhookTriggerPlaceholderData extends Record<string, unknown> {
  trigger: Extract<TriggerConfig, { type: 'webhook' }>;
}

/**
 * Placeholder rendering for legacy webhook triggers stored in workflow
 * definitions. A dedicated `WebhookTriggerNode` will replace this — the
 * typed-split intentionally leaves the slot empty until then.
 */
export function WebhookTriggerPlaceholderNode({ data, selected }: NodeProps) {
  const { trigger } = data as WebhookTriggerPlaceholderData;
  return (
    <TriggerNodeShell
      selected={selected}
      icon={<Webhook size={11} color="#FFFFFF" strokeWidth={1.5} />}
      label="Webhook"
      detail={trigger.event}
      platform={trigger.platform}
    />
  );
}
