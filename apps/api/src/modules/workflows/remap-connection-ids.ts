import type { WorkflowDefinition } from '@conduit/shared';

/**
 * Deep-clone the definition and rewrite every `connectionId` to point at a
 * cloned connection (per `idMap`). Refs missing from the map are left intact
 * so the duplicate at least round-trips; a broken ref surfaces on save
 * validation later.
 *
 * Mirrors the slot enumeration in `@conduit/shared/template/resolve.ts` —
 * any new connection-bearing field there must be added here too. Node
 * workspaces no longer carry connections (post Phase 2 consolidation): the
 * trigger's connection is the workflow's single source of truth.
 */
export function remapConnectionIds(
  definition: unknown,
  idMap: Record<string, string>,
): WorkflowDefinition {
  const cloned = JSON.parse(JSON.stringify(definition)) as Partial<WorkflowDefinition>;
  const remap = (id: string | undefined) => (id ? idMap[id] : undefined);

  for (const trigger of cloned.triggers ?? []) {
    const next = remap(trigger.connectionId);
    if (next) trigger.connectionId = next;
  }
  for (const server of cloned.mcpServers ?? []) {
    const next = remap(server.connectionId);
    if (next) server.connectionId = next;
  }
  return cloned as WorkflowDefinition;
}
