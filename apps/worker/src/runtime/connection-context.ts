import path from 'node:path';
import type { ConnectionContext } from '@conduit/agent';
import { connectionScopeSchema } from '@conduit/shared';
import { normalizeHostUrl } from '@conduit/shared/platform';
import { decryptSecret, loadEncryptionKey } from '@conduit/shared/crypto';
import { prisma } from './prisma';

/**
 * Hydrate the subset of `Connection` the workspace manager needs for a
 * clone. The bound scope must be `github_repo` or `gitlab_project` — for
 * any other kind, return `undefined` so callers can throw rather than
 * silently cloning the wrong thing.
 *
 * **Test hook**: when `CONDUIT_TEST_REMOTE_BASE` is set, the clone URL is
 * rebased under that directory (`<base>/<owner>/<repo>.git`). Lets the
 * E2E harness point both the base clone *and* post-resolve `origin` at a
 * local bare repo so `git push` works without touching github.com. The var
 * must be unset in production — there is no production use case for it.
 */
export async function loadConnectionContext(
  connectionId: string,
): Promise<ConnectionContext | undefined> {
  const conn = await prisma().connection.findUnique({
    where: { id: connectionId },
    include: { credential: true },
  });
  if (!conn) return undefined;
  const scope = connectionScopeSchema.parse(conn.scope);

  // Derive owner/repo from the scope. Currently supports `github_repo` and
  // `gitlab_project` (string-compared — the `gitlab_project` variant will be
  // typed once gitlab-api-client adds it to the scope union).
  let owner: string;
  let repo: string;
  if (scope.kind === 'github_repo') {
    owner = scope.owner;
    repo = scope.repo;
  } else if ((scope as { kind: string }).kind === 'gitlab_project') {
    // GitLab project paths can be nested under subgroups
    // (e.g. `group/subgroup/project`). Take the last two segments so
    // `owner` maps to the immediate parent group and `repo` to the project.
    const segments = ((scope as Record<string, string>).projectPath ?? '').split('/').slice(-2);
    if (segments.length < 2 || !segments[0] || !segments[1]) return undefined;
    [owner, repo] = segments;
  } else {
    return undefined;
  }

  const token = decryptSecret(conn.credential.secret, loadEncryptionKey());
  const platform = conn.credential.platform === 'GITLAB' ? 'gitlab' : 'github';
  // Resolve host from the credential's persisted hostUrl, running through
  // normalizeHostUrl for defense-in-depth (falls back to canonical cloud
  // default if hostUrl is null — e.g. pre-migration rows).
  const host = normalizeHostUrl(conn.credential.hostUrl, conn.credential.platform)!;
  const testBase = process.env.CONDUIT_TEST_REMOTE_BASE;
  const cloneUrl = testBase
    ? path.join(testBase, owner, `${repo}.git`)
    : `https://${host}/${owner}/${repo}.git`;
  return {
    id: conn.id,
    platform,
    host,
    owner,
    repo,
    cloneUrl,
    token,
  };
}
