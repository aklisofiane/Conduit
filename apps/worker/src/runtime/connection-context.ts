import path from 'node:path';
import type { ConnectionContext } from '@conduit/agent';
import { connectionScopeSchema } from '@conduit/shared';
import { decryptSecret, loadEncryptionKey } from '@conduit/shared/crypto';
import { prisma } from './prisma';

/**
 * Hydrate the subset of `Connection` the workspace manager needs for a
 * clone. The bound scope must be `github_repo` — for any other kind, return
 * `undefined` so callers can throw rather than silently cloning the wrong
 * thing.
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
  if (scope.kind !== 'github_repo') return undefined;
  const token = decryptSecret(conn.credential.secret, loadEncryptionKey());
  const platform = conn.credential.platform === 'GITLAB' ? 'gitlab' : 'github';
  const host = platform === 'github' ? 'github.com' : 'gitlab.com';
  const testBase = process.env.CONDUIT_TEST_REMOTE_BASE;
  const cloneUrl = testBase
    ? path.join(testBase, scope.owner, `${scope.repo}.git`)
    : `https://${host}/${scope.owner}/${scope.repo}.git`;
  return {
    id: conn.id,
    platform,
    owner: scope.owner,
    repo: scope.repo,
    cloneUrl,
    token,
  };
}
