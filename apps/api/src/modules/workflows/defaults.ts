import type { WorkflowDefinition } from '@conduit/shared';

export type InitialTriggerType = 'issues' | 'pull_requests' | 'cron';

/**
 * Build a starter definition. When `triggerType` is provided (the normal
 * path from the "New workflow" dialog), the canvas opens with the user's
 * chosen trigger already placed. Without one, the canvas is blank.
 */
export function defaultDefinition(triggerType?: InitialTriggerType): WorkflowDefinition {
  if (!triggerType) {
    return {
      triggers: [],
      nodes: [],
      edges: [],
      mcpServers: [],
      ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
    };
  }

  const id = `trigger_${Math.random().toString(36).slice(2, 10)}`;
  const name = 'Trigger1';
  const shared = { id, name, platform: 'github' as const, connectionId: '' };
  const trigger =
    triggerType === 'cron'
      ? { ...shared, type: 'cron' as const, cron: '0 9 * * *', timezone: 'UTC', branch: 'main' }
      : { ...shared, type: triggerType, intervalSec: 60, filters: [] as never[] };

  return {
    triggers: [trigger],
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: {
      nodePositions: { [name]: { x: 80, y: 120 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}
