import type { CredentialLookup } from '@conduit/agent';
import { decryptSecret, loadEncryptionKey } from '@conduit/shared/crypto';
import { prisma } from './prisma';

/**
 * Build a `CredentialLookup` bound to this run. Returns undefined for
 * missing connections so the MCP resolver can throw a clean error.
 *
 * Uses the shared `@conduit/shared` crypto primitives so the on-disk
 * payload format and key resolution stay byte-compatible with the API.
 */
export function makeCredentialLookup(): CredentialLookup {
  return async (connectionId: string): Promise<string | undefined> => {
    const conn = await prisma().workflowConnection.findUnique({
      where: { id: connectionId },
      include: { credential: true },
    });
    if (!conn) return undefined;
    return decryptSecret(conn.credential.secret, loadEncryptionKey());
  };
}
