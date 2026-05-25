import { z } from 'zod';

/**
 * Typed binding carried on every `Connection` row. Discriminated by `kind` so
 * adding a new platform variant (e.g. `slack_workspace`, `gitlab_repo`) is a
 * one-file change here. Connections without a meaningful binding (a token-only
 * Slack workspace today) carry `{ kind: 'none' }` rather than `null` so
 * consumers always switch over a discriminator.
 */
export const githubRepoScopeSchema = z.object({
  kind: z.literal('github_repo'),
  owner: z.string().min(1),
  repo: z.string().min(1),
});
export type GithubRepoScope = z.infer<typeof githubRepoScopeSchema>;

export const githubProjectsV2ScopeSchema = z.object({
  kind: z.literal('github_projects_v2'),
  ownerType: z.enum(['user', 'org']),
  owner: z.string().min(1),
  // GitHub Projects v2 addresses projects by a numeric "project number"
  // scoped to the owner (org or user). Stored as the integer so the GraphQL
  // client doesn't have to re-parse a URL on every poll cycle.
  number: z.number().int().positive(),
});
export type GithubProjectsV2Scope = z.infer<typeof githubProjectsV2ScopeSchema>;

export const gitlabProjectScopeSchema = z.object({
  kind: z.literal('gitlab_project'),
  projectPath: z.string().min(1), // e.g., "acme/api" or "group/subgroup/api"
});
export type GitlabProjectScope = z.infer<typeof gitlabProjectScopeSchema>;

export const noneScopeSchema = z.object({
  kind: z.literal('none'),
});
export type NoneScope = z.infer<typeof noneScopeSchema>;

export const connectionScopeSchema = z.discriminatedUnion('kind', [
  githubRepoScopeSchema,
  githubProjectsV2ScopeSchema,
  gitlabProjectScopeSchema,
  noneScopeSchema,
]);
export type ConnectionScope = z.infer<typeof connectionScopeSchema>;
export type ConnectionScopeKind = ConnectionScope['kind'];

/**
 * Runtime narrow on a parsed `ConnectionScope`. Use at activity boundaries
 * (e.g. `workspace-clone` requires `github_repo`, `pollBoardActivity` requires
 * `github_projects_v2`) so the failure mode is a clean error rather than a
 * silent type-coerce.
 */
export function expectScopeKind<K extends ConnectionScopeKind>(
  scope: ConnectionScope,
  kind: K,
): Extract<ConnectionScope, { kind: K }> {
  if (scope.kind !== kind) {
    throw new Error(
      `Expected connection scope kind "${kind}", got "${scope.kind}"`,
    );
  }
  return scope as Extract<ConnectionScope, { kind: K }>;
}
