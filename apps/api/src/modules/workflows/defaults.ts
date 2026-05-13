import type { WorkflowDefinition } from '@conduit/shared';

/**
 * A freshly-created workflow lands on the canvas with a single trigger
 * and no agents — the user clicks "+ Agent" to add the first node. This
 * shape is what the canvas loads on `/workflows/new`.
 */
export function defaultDefinition(): WorkflowDefinition {
  return {
    triggers: [
      {
        id: 'trigger_default',
        name: 'Trigger1',
        platform: 'github',
        connectionId: '',
        type: 'issues',
        intervalSec: 60,
        filters: [],
      },
    ],
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: {
      nodePositions: { Trigger1: { x: 80, y: 120 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}
