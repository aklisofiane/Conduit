import { z } from 'zod';

/**
 * Credential platform — superset covering every integration Conduit stores
 * credentials for. Matches the Prisma `Platform` enum. Includes credential-only
 * platforms (Slack, Discord) that don't emit triggers.
 */
export const platformSchema = z.enum(['GITHUB', 'GITLAB', 'JIRA', 'SLACK', 'DISCORD']);
export type Platform = z.infer<typeof platformSchema>;

/**
 * Trigger source — subset of platforms that can fire workflow triggers.
 * Lowercase to match the runtime values used in `TriggerConfig` and `TriggerEvent`.
 */
export const triggerSourceSchema = z.enum(['github', 'gitlab', 'jira']);
export type TriggerSource = z.infer<typeof triggerSourceSchema>;
