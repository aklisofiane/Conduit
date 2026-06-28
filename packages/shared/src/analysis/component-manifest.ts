import { z } from 'zod';

/**
 * Inferred importance of a component, weighted alongside churn when the
 * Design agent picks a review cadence. Higher criticality + higher churn →
 * a tighter cron.
 */
export const componentCriticalitySchema = z.enum(['low', 'medium', 'high']);
export type ComponentCriticality = z.infer<typeof componentCriticalitySchema>;

/**
 * One component the Discover agent found in the repo. `paths` are glob(s)
 * relative to the repo root that scope a per-component review to this
 * component's files; the generated workflow bakes them into its Scope node.
 */
export const componentSchema = z.object({
  /** Human-readable component name, e.g. "API" or "Worker". Unique within a manifest. */
  name: z.string().min(1),
  /** Path glob(s) (repo-relative) that delimit the component's source. */
  paths: z.array(z.string().min(1)).min(1),
  /** One-line justification for treating this as a distinct component. */
  rationale: z.string().min(1),
  /**
   * Recent commit count touching the component — a coarse churn signal the
   * Design agent weights into cadence. Absent when the agent couldn't derive
   * it from `git log`.
   */
  churn: z.number().int().nonnegative().optional(),
  criticality: componentCriticalitySchema,
});
export type Component = z.infer<typeof componentSchema>;

export const MAX_COMPONENTS = 50;

/**
 * Structured Discover output. Written by the Discover agent as JSON to a
 * fixed workspace path (see `ANALYSIS_MANIFEST_PATH`) — a machine-read
 * artifact distinct from the markdown `.conduit/<Node>.md` summary the
 * runtime captures. A `readComponentManifest` activity Zod-validates this
 * so the workflow can fan out over a typed list.
 */
export const componentManifestSchema = z.object({
  components: z.array(componentSchema).min(1).max(MAX_COMPONENTS),
});
export type ComponentManifest = z.infer<typeof componentManifestSchema>;
