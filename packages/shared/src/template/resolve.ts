import type { WorkflowDefinition } from '../workflow/definition';
import type { TemplateFile, TemplateWorkflow } from './schema';
import { placeholderAlias } from './placeholder';

export function collectTemplatePlaceholders(template: TemplateFile): string[] {
  const aliases = new Set<string>();
  for (const wf of template.workflows) {
    for (const slot of enumerateConnectionSlots(wf.definition)) {
      const alias = placeholderAlias(slot.value);
      if (alias) aliases.add(alias);
    }
  }
  return [...aliases].sort();
}

export interface ResolvedTemplateWorkflow {
  name: string;
  description?: string;
  definition: WorkflowDefinition;
}

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
