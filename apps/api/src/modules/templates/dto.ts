import { z } from 'zod';

/**
 * Body for `POST /api/workflows/from-template/:templateId`.
 *
 * `bindings` maps each placeholder alias (e.g. `github`) to one of:
 *   - `{ connectionId }`   — use an existing WorkflowConnection by id
 *   - `{ credentialId, ... }` — create a new WorkflowConnection on each
 *     template workflow with the given credential + optional owner/repo
 *
 * The binding applies to every workflow in the bundle that references that
 * alias — connection rows are per-workflow, so creating a bundle of N
 * workflows with one `<github>` alias produces N connection rows that share
 * the same alias + credential.
 */
export const templateBindingSchema = z.union([
  z.object({
    mode: z.literal('existing'),
    connectionId: z.string().min(1),
  }),
  z.object({
    mode: z.literal('new'),
    alias: z.string().min(1).max(60),
    credentialId: z.string().min(1),
    owner: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    webhookSecret: z.string().min(1).optional(),
  }),
]);
export type TemplateBinding = z.infer<typeof templateBindingSchema>;

export const createFromTemplateDtoSchema = z.object({
  bindings: z.record(z.string(), templateBindingSchema).default({}),
});
export type CreateFromTemplateDto = z.infer<typeof createFromTemplateDtoSchema>;
