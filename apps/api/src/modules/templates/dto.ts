import { z } from 'zod';
import { connectionScopeSchema } from '@conduit/shared';

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
