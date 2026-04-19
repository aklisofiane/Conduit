import path from 'node:path';
import type { ConnectionContext } from '@conduit/agent';
import { prisma } from './prisma';
import { makeCredentialLookup } from './credential-lookup';

/**
 * Hydrate the subset of `WorkflowConnection` the workspace manager needs
 * for a clone. Missing owner/repo on a `repo-clone` workspace surfaces as
 * `undefined` here so the caller can throw rather than silently cloning
 * the wrong thing.
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
  const conn = await prisma().workflowConnection.findUnique({
    where: { id: connectionId },
    include: { credential: true },
  });
  if (!conn || !conn.owner || !conn.repo) return undefined;
  const lookup = makeCredentialLookup();
  const token = await lookup(connectionId);
  const platform = conn.credential.platform === 'GITLAB' ? 'gitlab' : 'github';
  const host = platform === 'github' ? 'github.com' : 'gitlab.com';
  const testBase = process.env.CONDUIT_TEST_REMOTE_BASE;
  const cloneUrl = testBase
    ? path.join(testBase, conn.owner, `${conn.repo}.git`)
    : `https://${host}/${conn.owner}/${conn.repo}.git`;
  return {
    id: conn.id,
    platform,
    owner: conn.owner,
    repo: conn.repo,
    cloneUrl,
    token,
  };
}
