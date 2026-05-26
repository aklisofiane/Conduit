import { z } from 'zod';

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

export const listViewerReposDtoSchema = z.object({
  credentialId: z.string().min(1),
});
export type ListViewerReposDto = z.infer<typeof listViewerReposDtoSchema>;

export const listViewerOrgsDtoSchema = z.object({
  credentialId: z.string().min(1),
});
export type ListViewerOrgsDto = z.infer<typeof listViewerOrgsDtoSchema>;

export const listLabelsDtoSchema = z.object({
  connectionId: z.string().min(1),
});
export type ListLabelsDto = z.infer<typeof listLabelsDtoSchema>;
