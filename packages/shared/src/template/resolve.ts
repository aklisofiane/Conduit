import type { WorkflowDefinition } from '../workflow/definition';
import type { ConnectionScopeKind } from '../connection/scope';
import type { TemplateFile, TemplateSummary, TemplateWorkflow } from './schema';
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

export function collectTemplatePlaceholderDetails(template: TemplateFile): TemplatePlaceholder[] {
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
  // A Projects-v2 Status can only be written when a board connection survives
  // resolution. If none does — no board slot at all, or the optional board
  // placeholder was left unbound and `clear()`ed above — strip
  // `allowedStatuses` from every agent's writeback. Otherwise the writeback
  // prompt still emits a "set the project Status" directive (gated only on
  // `allowedStatuses.length > 0`, see agent/context.ts) and sends the agent
  // hunting for a board that isn't there. Labels / PR-states are board-free and
  // pass through untouched.
  const hasBoard = definition.triggers.some((t) => t.boardConnectionId != null);
  if (!hasBoard) {
    for (const node of definition.nodes) {
      if (node.issueWriteback) node.issueWriteback.allowedStatuses = [];
    }
  }
  return { name: wf.name, description: wf.description, definition };
}

/**
 * Pure summary of a template bundle: identity fields plus the unique
 * connection placeholders and the board-typed subset (optional bindings).
 * Shared so the API catalog path and the web import path derive an identical
 * `TemplateSummary` from the same file.
 */
export function summarizeTemplate(file: TemplateFile): TemplateSummary {
  const placeholderDetails = collectTemplatePlaceholderDetails(file);
  return {
    id: file.id,
    name: file.name,
    description: file.description,
    category: file.category,
    workflowCount: file.workflows.length,
    placeholders: placeholderDetails.map((p) => p.alias),
    boardAliases: placeholderDetails
      .filter((p) => p.expectedScopeKinds.includes('github_projects_v2'))
      .map((p) => p.alias),
  };
}

export interface ConnectionSlot {
  value: string | undefined;
  expectedScopeKind: ExpectedSlotKind;
  optional?: boolean;
  set: (v: string) => void;
  clear?: () => void;
}

/**
 * Walks every connection-bearing slot in a definition — trigger
 * `connectionId`, trigger `boardConnectionId`, and MCP-server `connectionId`.
 * `resolveTemplate` uses it to write real ids into placeholders; export uses
 * it to write placeholders over real ids. Keeping a single enumerator means
 * the two directions can never drift apart.
 */
export function* enumerateConnectionSlots(def: WorkflowDefinition): Generator<ConnectionSlot> {
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
      // Preset-backed servers are swapped to the bound connection's platform
      // preset at instantiation, so the connection must be repo-scoped
      // (github_repo | gitlab_project — the platforms that ship presets).
      // User-defined transports stay `'any'`: platform-only matching, never
      // rewritten.
      expectedScopeKind: server.presetId ? 'repo' : 'any',
      set: (v) => {
        server.connectionId = v;
      },
    };
  }
}
