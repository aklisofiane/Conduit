import { decryptSecret, loadEncryptionKey } from '@conduit/shared/crypto';
import { prisma } from './prisma';

export interface ResolvedProviderConfig {
  apiKey: string;
  baseUrl?: string;
  extraEnv?: Record<string, string>;
}

/**
 * Load the per-org `ProviderConfig` for an agent provider id. Reads via
 * Prisma and decrypts the API key with the same `@conduit/shared/crypto`
 * pipeline the API uses. Returns `undefined` when no row exists so callers
 * can fall back to env defaults.
 *
 * No caching in v1 — one read per agent activity is cheap and avoids stale
 * keys after a rotation.
 */
export async function loadProviderConfig(
  orgId: string,
  providerId: string,
): Promise<ResolvedProviderConfig | undefined> {
  const row = await prisma().providerConfig.findUnique({
    where: { orgId_providerId: { orgId, providerId } },
  });
  if (!row) return undefined;
  const apiKey = decryptSecret(row.encryptedApiKey, loadEncryptionKey());
  return {
    apiKey,
    baseUrl: row.baseUrl ?? undefined,
    extraEnv: parseExtraEnv(row.extraEnv),
  };
}

function parseExtraEnv(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
