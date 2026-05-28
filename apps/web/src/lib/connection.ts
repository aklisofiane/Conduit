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
