import type { TriggerConfig } from '@conduit/shared';

/**
 * Pure (component-free) trigger defaults, shared by the canvas trigger
 * registry and the `useCreateWorkflow` quick-create path. Kept out of the
 * `components/canvas` registry so the API hooks layer can build a default
 * trigger without pulling React node/panel components into the data layer.
 */

/** Trigger variants the palette / quick-create can materialize. */
export const ADDABLE_TRIGGER_TYPES = ['issues', 'pull_requests', 'cron'] as const;
export type PaletteTriggerType = (typeof ADDABLE_TRIGGER_TYPES)[number];

/** Fields a new trigger always carries; the rest is variant-specific. */
export interface TriggerDefaultsContext {
  id: string;
  name: string;
  platform?: 'github' | 'gitlab';
  connectionId?: string;
}

type AddableTrigger = Extract<TriggerConfig, { type: PaletteTriggerType }>;

/**
 * Build the default config for a freshly created trigger of an addable
 * variant. `platform` defaults to `github` and `connectionId` to empty —
 * the canvas leaves both unset, the quick-create path supplies them.
 */
export function makeDefaultTrigger(
  type: PaletteTriggerType,
  ctx: TriggerDefaultsContext,
): AddableTrigger {
  const shared = {
    id: ctx.id,
    name: ctx.name,
    platform: ctx.platform ?? ('github' as const),
    connectionId: ctx.connectionId ?? '',
  };
  switch (type) {
    case 'issues':
      return { ...shared, type: 'issues', intervalSec: 60, filters: [] };
    case 'pull_requests':
      return { ...shared, type: 'pull_requests', intervalSec: 60, filters: [] };
    case 'cron':
      return { ...shared, type: 'cron', cron: '0 9 * * *', timezone: 'UTC', branch: 'main' };
  }
}

/**
 * One-line summary for a trigger, dispatched on its variant. Pure (no React)
 * so the workflow-list row can render it without pulling the canvas node /
 * panel components in.
 */
export function triggerSummary(trigger: TriggerConfig): string {
  switch (trigger.type) {
    case 'issues':
      return `polling · every ${trigger.intervalSec}s`;
    case 'pull_requests':
      return `polling · every ${trigger.intervalSec}s · prs`;
    case 'cron':
      return `schedule · ${trigger.cron} · ${trigger.timezone}`;
    case 'webhook':
      return trigger.event;
  }
}
