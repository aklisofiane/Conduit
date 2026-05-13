import { z } from 'zod';

/**
 * Two token sources: an existing Connection (trigger-config flow) or a raw
 * Credential (settings-flow preview before the Connection is created).
 * `refine` lets the schema enforce "exactly one" without giving up the
 * shared owner/ownerType shape.
 */
export const listProjectsDtoSchema = z
  .object({
    connectionId: z.string().min(1).optional(),
    credentialId: z.string().min(1).optional(),
    ownerType: z.enum(['user', 'org']),
    owner: z.string().min(1),
  })
  .refine(
    (v) => !!v.connectionId !== !!v.credentialId,
    'Pass exactly one of connectionId or credentialId',
  );
export type ListProjectsDto = z.infer<typeof listProjectsDtoSchema>;

export const listLabelsDtoSchema = z.object({
  connectionId: z.string().min(1),
});
export type ListLabelsDto = z.infer<typeof listLabelsDtoSchema>;
