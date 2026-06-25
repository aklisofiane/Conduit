import type { ConnectionScope, ConnectionScopeKind } from '@conduit/shared';
import { isCloudHost } from '@conduit/shared/platform';
import type { Platform } from '@conduit/shared/platform';

export function scopeSummary(scope: ConnectionScope): string {
  switch (scope.kind) {
    case 'github_repo':
      return `${scope.owner}/${scope.repo}`;
    case 'github_projects_v2':
      return `${scope.owner} · project #${scope.number}`;
    case 'gitlab_project':
      return scope.projectPath;
    case 'none':
      return '';
  }
}

/**
 * Returns the repo-scoped `ConnectionScopeKind` for a given trigger platform.
 * GitLab uses `gitlab_project`; everything else uses `github_repo`.
 */
export function repoScopeKindFor(platform: string): ConnectionScopeKind {
  return platform === 'gitlab' ? 'gitlab_project' : 'github_repo';
}

/**
 * Keep only connections bound to a repo/project — the source binding the
 * trigger panels offer in their connection picker. Excludes board
 * (`github_projects_v2`) and unscoped (`none`) connections.
 */
export function repoScopedConnections<T extends { scope: ConnectionScope }>(
  connections: T[],
): T[] {
  return connections.filter(
    (c) => c.scope.kind === 'github_repo' || c.scope.kind === 'gitlab_project',
  );
}

/**
 * The repo/project a missing `conduit-*` label can be created on. Consumed by
 * the trigger panel's inline "create label" action and the connection-time
 * label prompt. Undefined when the connection isn't bound to a repo/project.
 */
export interface EnsureLabelTarget {
  connectionId: string;
  /** Display string for the button, e.g. `owner/repo` or a GitLab path. */
  scopeLabel: string;
}

/**
 * Build the create-label target for a connection — present only when it's
 * bound to a repo/project (labels live there).
 */
export function ensureLabelTarget(
  connections: { id: string; name: string; scope: ConnectionScope }[],
  connectionId: string,
): EnsureLabelTarget | undefined {
  const conn = connections.find((c) => c.id === connectionId);
  if (
    !conn ||
    (conn.scope.kind !== 'github_repo' && conn.scope.kind !== 'gitlab_project')
  ) {
    return undefined;
  }
  return {
    connectionId: conn.id,
    scopeLabel: scopeSummary(conn.scope) || conn.name,
  };
}

export function connectionLabel(c: {
  name: string;
  credential: { platform: string; hostUrl?: string | null };
}): string {
  const host = c.credential.hostUrl;
  const showHost = host != null && !isCloudHost(c.credential.platform.toUpperCase() as Platform, host);
  const hostSuffix = showHost ? ` · ${host}` : '';
  return `${c.name} · ${c.credential.platform.toLowerCase()}${hostSuffix}`;
}

export interface RepoGroupRef {
  key: string;
  label: string;
  platform: 'github' | 'gitlab';
  hostUrl: string | null;
}

/**
 * Returns a stable group ref for a repo-shaped connection (so workflows
 * sharing a repo across hosts don't collapse together). Non-repo scopes
 * (`github_projects_v2`, `none`) and missing connections return `null` so
 * callers can route them to a "no repo" bucket.
 */
export function repoGroupRef(
  scope: ConnectionScope,
  credentialPlatform: string,
  credentialHostUrl: string | null,
): RepoGroupRef | null {
  const platformUpper = credentialPlatform.toUpperCase() as Platform;
  const showHost = credentialHostUrl != null && !isCloudHost(platformUpper, credentialHostUrl);
  const hostUrl = showHost ? credentialHostUrl : null;
  const hostPart = hostUrl ?? '';
  if (scope.kind === 'github_repo') {
    return {
      key: `github:${hostPart}:${scope.owner}/${scope.repo}`,
      label: `${scope.owner}/${scope.repo}`,
      platform: 'github',
      hostUrl,
    };
  }
  if (scope.kind === 'gitlab_project') {
    return {
      key: `gitlab:${hostPart}:${scope.projectPath}`,
      label: scope.projectPath,
      platform: 'gitlab',
      hostUrl,
    };
  }
  return null;
}
