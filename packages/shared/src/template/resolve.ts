import type { WorkflowDefinition } from '../workflow/definition';
import type { ConnectionScopeKind } from '../connection/scope';
import type { TemplateFile, TemplateWorkflow } from './schema';
import { placeholderAlias } from './placeholder';

/** Per-slot expected scope; `'repo'` = github_repo | gitlab_project; `'any'` = skip check. */
export type ExpectedSlotKind = ConnectionScopeKind | 'any' | 'repo';

export interface TemplatePlaceholder {
  alias: string;
  /**
   * Unique scope kinds the alias resolves into across all slots in the
   * bundle. The `from-template` endpoint validates that the bound
   * Connection's `scope.kind` is compatible with at least the strictest
   * entry here; `'any'` means platform-only matching.
   */
  expectedScopeKinds: ExpectedSlotKind[];
}

/**
 * Returns unique placeholder aliases sorted alphabetically. Compatible with
 * the prior signature so existing callers keep working; richer per-slot
 * type information lives on `collectTemplatePlaceholderDetails`.
 */
export function collectTemplatePlaceholders(template: TemplateFile): string[] {
  return collectTemplatePlaceholderDetails(template).map((p) => p.alias);
}

export function collectTemplatePlaceholderDetails(
  template: TemplateFile,
): TemplatePlaceholder[] {
  const byAlias = new Map<string, Set<ExpectedSlotKind>>();
  for (const wf of template.workflows) {
    for (const slot of enumerateConnectionSlots(wf.definition)) {
      const alias = placeholderAlias(slot.value);
      if (!alias) continue;
      const set = byAlias.get(alias) ?? new Set<ExpectedSlotKind>();
      set.add(slot.expectedScopeKind);
      byAlias.set(alias, set);
    }
  }
  return [...byAlias.entries()]
    .map(([alias, kinds]) => ({
      alias,
      expectedScopeKinds: [...kinds].sort(),
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
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
      if (slot.optional) {
        slot.clear?.();
        continue;
      }
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
  expectedScopeKind: ExpectedSlotKind;
  optional?: boolean;
  set: (v: string) => void;
  clear?: () => void;
}

function* enumerateConnectionSlots(
  def: WorkflowDefinition,
): Generator<ConnectionSlot> {
  for (const trigger of def.triggers) {
    yield {
      value: trigger.connectionId,
      expectedScopeKind: 'repo',
      set: (v) => {
        trigger.connectionId = v;
      },
    };
    if (trigger.boardConnectionId != null) {
      yield {
        value: trigger.boardConnectionId,
        expectedScopeKind: 'github_projects_v2',
        optional: true,
        set: (v) => {
          trigger.boardConnectionId = v;
        },
        clear: () => {
          trigger.boardConnectionId = undefined;
        },
      };
    }
  }
  for (const server of def.mcpServers) {
    yield {
      value: server.connectionId,
      // MCP filtering is platform-only in v1; per-preset scope-kind checks
      // are a follow-up. Surfacing `'any'` here lets the from-template
      // endpoint skip the kind check for MCP slots without losing the rule
      // for trigger slots.
      expectedScopeKind: 'any',
      set: (v) => {
        server.connectionId = v;
      },
    };
  }
}
