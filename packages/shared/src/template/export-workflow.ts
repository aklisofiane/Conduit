import type { WorkflowDefinition } from '../workflow/definition';
import type { TemplateFile } from './schema';
import { formatPlaceholder, placeholderAlias } from './placeholder';
import { enumerateConnectionSlots } from './resolve';

export interface WorkflowToTemplateInput {
  name: string;
  description?: string;
  definition: WorkflowDefinition;
}

export interface WorkflowToTemplateOptions {
  /**
   * Maps a concrete Connection id to the `<alias>` placeholder that should
   * stand in for it. The caller owns alias naming because it has the
   * connection names; this helper only substitutes. Called once per unique id.
   */
  aliasFor: (connectionId: string) => string;
}

/**
 * Reduces a live workflow to a portable single-workflow `TemplateFile`: every
 * connection reference becomes an `<alias>` placeholder, so the bundle carries
 * no org-specific ids. The exact inverse of `resolveTemplate` — both walk the
 * same `enumerateConnectionSlots`. Agents are already in runtime shape
 * (concrete provider/model/instructions), so nothing else needs stripping.
 */
export function workflowToTemplate(
  workflow: WorkflowToTemplateInput,
  opts: WorkflowToTemplateOptions,
): TemplateFile {
  const definition = structuredClone(workflow.definition);
  for (const slot of enumerateConnectionSlots(definition)) {
    if (!slot.value) continue;
    // Idempotent: a definition that already carries placeholders stays as-is.
    if (placeholderAlias(slot.value)) continue;
    slot.set(formatPlaceholder(opts.aliasFor(slot.value)));
  }

  const description = workflow.description?.trim() || workflow.name;
  return {
    id: slugifyTemplateId(workflow.name),
    name: workflow.name,
    description,
    category: 'custom',
    workflows: [
      {
        name: workflow.name,
        description: workflow.description,
        definition,
      },
    ],
  };
}

/**
 * Kebab-cases a workflow name into a valid template id (`^[a-z][a-z0-9-]*$`),
 * falling back to `exported-workflow` when nothing usable survives.
 */
export function slugifyTemplateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '') // ids must start with a letter
    .replace(/-+$/, '');
  return /^[a-z][a-z0-9-]*$/.test(slug) ? slug : 'exported-workflow';
}
