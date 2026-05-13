import type { ConnectionScope } from '@conduit/shared';

export function scopeSummary(scope: ConnectionScope): string {
  switch (scope.kind) {
    case 'github_repo':
      return `${scope.owner}/${scope.repo}`;
    case 'github_projects_v2':
      return `${scope.owner} · project #${scope.number}`;
    case 'none':
      return '';
  }
}

export function connectionLabel(c: {
  name: string;
  credential: { platform: string };
}): string {
  return `${c.name} · ${c.credential.platform.toLowerCase()}`;
}
