import type { ConnectionContext } from '@conduit/agent';
import { prisma } from './prisma';
import { makeCredentialLookup } from './credential-lookup';

/**
 * Hydrate the subset of `WorkflowConnection` the workspace manager needs
 * for a clone. Missing owner/repo on a `repo-clone` workspace surfaces as
 * `undefined` here so the caller can throw rather than silently cloning
 * the wrong thing.
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
  return {
    id: conn.id,
    platform,
    owner: conn.owner,
    repo: conn.repo,
    cloneUrl: `https://${host}/${conn.owner}/${conn.repo}.git`,
    token,
  };
}
