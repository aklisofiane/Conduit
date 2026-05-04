import { z } from 'zod';

/**
 * List-projects request — proves the GitHub connection works and returns
 * every Projects v2 board under an owner so the trigger config UI can
 * offer a real dropdown (instead of a "type the project number" input)
 * with each board's single-select fields preloaded for the filter editor.
 */
export const listProjectsDtoSchema = z.object({
  connectionId: z.string().min(1),
  ownerType: z.enum(['user', 'org']),
  owner: z.string().min(1),
});
export type ListProjectsDto = z.infer<typeof listProjectsDtoSchema>;
