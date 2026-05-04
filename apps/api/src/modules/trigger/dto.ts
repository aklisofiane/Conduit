import { z } from 'zod';

export const listProjectsDtoSchema = z.object({
  connectionId: z.string().min(1),
  ownerType: z.enum(['user', 'org']),
  owner: z.string().min(1),
});
export type ListProjectsDto = z.infer<typeof listProjectsDtoSchema>;
