import type { WorkflowDefinition } from '@conduit/shared';

/**
 * A freshly-created workflow lands on the canvas with a single trigger
 * and no agents — the user clicks "+ Agent" to add the first node. This
 * shape is what the canvas loads on `/workflows/new`.
 */
export function defaultDefinition(): WorkflowDefinition {
  return {
    trigger: {
      platform: 'github',
      connectionId: '',
      mode: { kind: 'webhook', event: 'issues.opened', active: false },
      filters: [],
    },
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: {
      nodePositions: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}
