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

export function connectionLabel(c: {
  name: string;
  credential: { platform: string; hostUrl?: string | null };
}): string {
  const host = c.credential.hostUrl;
  const showHost = host != null && !isCloudHost(c.credential.platform.toUpperCase() as Platform, host);
  const hostSuffix = showHost ? ` · ${host}` : '';
  return `${c.name} · ${c.credential.platform.toLowerCase()}${hostSuffix}`;
}
