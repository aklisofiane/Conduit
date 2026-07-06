import {
  decryptSecretWithFallback,
  encryptSecret,
  loadEncryptionKeys,
  redactedSuffix,
} from '@conduit/shared/crypto';
import { config } from '../../config';

/**
 * API-side credential crypto. The shared `@conduit/shared/crypto` module
 * owns the AES-256-GCM format and key resolution; this thin wrapper binds
 * the API's key policy: auto-generate the key file on first use in local
 * deployments only. Hosted requires an explicit key — multiple replicas
 * would otherwise each mint their own random key and silently corrupt every
 * stored credential (`assertHostedSafety` enforces this at boot).
 */
export function encryptionKey(): Buffer {
  return loadEncryptionKeys({ autoGenerate: config.deployment === 'local' }).primary;
}

export function encrypt(plaintext: string): string {
  return encryptSecret(plaintext, encryptionKey());
}

export function decrypt(payload: string): string {
  return decryptSecretWithFallback(
    payload,
    loadEncryptionKeys({ autoGenerate: config.deployment === 'local' }),
  );
}

/**
 * Like `decrypt` but swallows errors and returns `undefined`. Use from
 * non-critical paths (list/redaction) where a corrupt blob shouldn't 500;
 * never use when the caller must distinguish "wrong key" from "not set".
 */
export function safeDecrypt(payload: string): string | undefined {
  try {
    return decrypt(payload);
  } catch {
    return undefined;
  }
}

/**
 * Decrypt and return only the redacted suffix (e.g. `****abcd`) for display.
 * A corrupt or undecryptable blob collapses to `****` rather than throwing —
 * used by list/row mappers that must never 500 on a single bad secret.
 */
export function redactSafely(encrypted: string): string {
  const plain = safeDecrypt(encrypted);
  return plain === undefined ? '****' : redactedSuffix(plain);
}

export { redactedSuffix };
