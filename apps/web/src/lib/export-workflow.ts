import {
  enumerateConnectionSlots,
  placeholderAlias,
  workflowToTemplate,
} from '@conduit/shared/template';
import type { WorkflowDefinition } from '@conduit/shared';
import type { ConnectionRow } from '../api/types.js';

interface ExportableWorkflow {
  name: string;
  description?: string | null;
  definition: WorkflowDefinition;
}

/**
 * Derives an `<alias>` for every connection id referenced by the workflow,
 * named after the bound connection (kebab-cased, de-duplicated per unique id).
 * Falls back to the slot kind (`repo` / `board`) or `conn-N` when the
 * connection is unnamed or no longer in the list.
 */
function buildAliasMap(
  definition: WorkflowDefinition,
  connections: ConnectionRow[],
): Map<string, string> {
  const nameById = new Map(connections.map((c) => [c.id, c.name]));
  const aliasById = new Map<string, string>();
  const used = new Set<string>();
  let counter = 0;

  // Reading `slot.value` doesn't mutate — `set` is what writes back — so we can
  // walk the live definition directly.
  for (const slot of enumerateConnectionSlots(definition)) {
    const id = slot.value;
    if (!id || placeholderAlias(id)) continue;
    if (aliasById.has(id)) continue;

    const fallback =
      slot.expectedScopeKind === 'github_projects_v2'
        ? 'board'
        : slot.expectedScopeKind === 'repo'
          ? 'repo'
          : `conn-${++counter}`;
    const base = kebab(nameById.get(id)) || fallback;
    aliasById.set(id, dedupe(base, used));
  }
  return aliasById;
}

function kebab(value: string | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '');
}

function dedupe(base: string, used: Set<string>): string {
  let alias = base;
  let n = 2;
  while (used.has(alias)) alias = `${base}-${n++}`;
  used.add(alias);
  return alias;
}

/**
 * Builds a portable `custom` template bundle from a live workflow and triggers
 * a browser download of `<slug>.json`. Pure client-side — a definition carries
 * no secrets once connection ids become placeholders.
 */
export function downloadWorkflowExport(
  workflow: ExportableWorkflow,
  connections: ConnectionRow[],
): void {
  const aliasById = buildAliasMap(workflow.definition, connections);
  const file = workflowToTemplate(
    {
      name: workflow.name,
      description: workflow.description ?? undefined,
      definition: workflow.definition,
    },
    { aliasFor: (id) => aliasById.get(id) ?? id },
  );

  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${file.id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
