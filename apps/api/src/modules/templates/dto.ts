import { z } from 'zod';
import { connectionScopeSchema, templateFileSchema } from '@conduit/shared';

export const templateBindingSchema = z.union([
  z.object({
    mode: z.literal('existing'),
    connectionId: z.string().min(1),
  }),
  z.object({
    mode: z.literal('new'),
    name: z.string().min(1).max(120),
    credentialId: z.string().min(1),
    scope: connectionScopeSchema,
  }),
]);
export type TemplateBinding = z.infer<typeof templateBindingSchema>;

export const createFromTemplateDtoSchema = z.object({
  bindings: z.record(z.string(), templateBindingSchema).default({}),
});
export type CreateFromTemplateDto = z.infer<typeof createFromTemplateDtoSchema>;

/**
 * Body for `POST /workflows/import`: an uploaded template bundle plus the
 * binding choices. Unlike the catalog path, the bundle arrives in the request
 * instead of being looked up by id, so it is parsed against the same
 * `templateFileSchema` the disk loader uses before instantiation.
 */
export const importTemplateDtoSchema = z.object({
  template: templateFileSchema,
  bindings: z.record(z.string(), templateBindingSchema).default({}),
});
export type ImportTemplateDto = z.infer<typeof importTemplateDtoSchema>;
