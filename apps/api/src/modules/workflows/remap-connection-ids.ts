import type { WorkflowDefinition } from '@conduit/shared';

/**
 * Deep-clone the definition and rewrite every `connectionId` to point at a
 * cloned connection (per `idMap`). Refs missing from the map are left intact
 * so the duplicate at least round-trips; a broken ref will surface on save
 * validation later.
 *
 * Locations a `connectionId` can appear:
 *  - `triggers[*].connectionId`             (trigger config)
 *  - `nodes[*].workspace.connectionId`      (`repo-clone`, `ticket-branch`)
 */
export function remapConnectionIds(
  definition: unknown,
  idMap: Record<string, string>,
): WorkflowDefinition {
  const cloned = JSON.parse(JSON.stringify(definition)) as Partial<WorkflowDefinition>;
  for (const trigger of cloned.triggers ?? []) {
    const next = trigger.connectionId ? idMap[trigger.connectionId] : undefined;
    if (next) trigger.connectionId = next;
  }
  for (const node of cloned.nodes ?? []) {
    const ws = node.workspace;
    if (ws && (ws.kind === 'repo-clone' || ws.kind === 'ticket-branch')) {
      const next = idMap[ws.connectionId];
      if (next) ws.connectionId = next;
    }
  }
  return cloned as WorkflowDefinition;
}
