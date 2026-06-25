/**
 * Split a GitLab `path_with_namespace` into `{ owner, name }`. GitLab paths
 * may include subgroups (`group/subgroup/api`), so the last segment is `name`
 * and everything before it is joined back as `owner` — mirroring the two-part
 * `{ owner, name }` shape used by `ProjectBoardItem.repo`. Kept in its own
 * dependency-free module so the webhook normalizer can reuse it without
 * pulling in the GitLab REST client.
 */
export function splitProjectPath(projectPath: string): { owner: string; name: string } {
  const parts = projectPath.split('/');
  if (parts.length < 2) return { owner: '', name: projectPath };
  return {
    owner: parts.slice(0, -1).join('/'),
    name: parts[parts.length - 1]!,
  };
}
