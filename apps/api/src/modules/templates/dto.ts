import { z } from 'zod';

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
