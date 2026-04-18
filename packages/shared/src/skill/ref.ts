import { z } from 'zod';

/**
 * Reference to a discovered skill (a `SKILL.md` bundle from `.claude/skills/`,
 * `.agents/skills/`, or the worker host). The runtime copies selected skills
 * into the workspace before invoking the provider.
 */
export const skillRefSchema = z.object({
  skillId: z.string().min(1),
  source: z.enum(['repo', 'worker']),
});
export type SkillRef = z.infer<typeof skillRefSchema>;
