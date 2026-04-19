import type { WorkflowDefinition } from '../workflow/definition';
import type { TemplateFile, TemplateWorkflow } from './schema';
import { isPlaceholder, placeholderAlias } from './placeholder';

/**
 * Walks every `connectionId` slot in a template bundle and collects the unique
 * set of placeholder aliases. Those aliases are what the UI prompts the user
 * to bind before creation.
 *
 * Slots checked:
 *   - `trigger.connectionId`
 *   - `mcpServers[].connectionId`
 *   - `nodes[].workspace.connectionId` (repo-clone + ticket-branch)
 */
export function collectTemplatePlaceholders(template: TemplateFile): string[] {
  const aliases = new Set<string>();
  for (const wf of template.workflows) {
    for (const slot of enumerateConnectionSlots(wf.definition)) {
      if (isPlaceholder(slot.value)) {
        const alias = placeholderAlias(slot.value);
        if (alias) aliases.add(alias);
      }
    }
  }
  return [...aliases].sort();
}

export interface ResolvedTemplateWorkflow {
  name: string;
  description?: string;
  definition: WorkflowDefinition;
}

/**
 * Substitutes placeholder `<alias>` strings with real `WorkflowConnection` ids
 * drawn from `bindings`. Returns a fresh deep copy; the input is not mutated.
 * Throws if the template references an alias not present in `bindings`.
 */
export function resolveTemplate(
  template: TemplateFile,
  bindings: Record<string, string>,
): ResolvedTemplateWorkflow[] {
  return template.workflows.map((wf) => resolveOne(wf, bindings));
}

function resolveOne(
  wf: TemplateWorkflow,
  bindings: Record<string, string>,
): ResolvedTemplateWorkflow {
  const definition = structuredClone(wf.definition);
  for (const slot of enumerateConnectionSlots(definition)) {
    if (!isPlaceholder(slot.value)) continue;
    const alias = placeholderAlias(slot.value);
    if (!alias) continue;
    const connId = bindings[alias];
    if (!connId) {
      throw new Error(
        `Template workflow "${wf.name}" references placeholder <${alias}> but no binding was provided.`,
      );
    }
    slot.set(connId);
  }
  return { name: wf.name, description: wf.description, definition };
}

interface ConnectionSlot {
  value: string | undefined;
  set: (v: string) => void;
}

function* enumerateConnectionSlots(
  def: WorkflowDefinition,
): Generator<ConnectionSlot> {
  yield {
    value: def.trigger.connectionId,
    set: (v) => {
      def.trigger.connectionId = v;
    },
  };
  for (const server of def.mcpServers) {
    yield {
      value: server.connectionId,
      set: (v) => {
        server.connectionId = v;
      },
    };
  }
  for (const node of def.nodes) {
    const ws = node.workspace;
    if (ws.kind === 'repo-clone' || ws.kind === 'ticket-branch') {
      yield {
        value: ws.connectionId,
        set: (v) => {
          ws.connectionId = v;
        },
      };
    }
  }
}
