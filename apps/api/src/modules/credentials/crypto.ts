import {
  decryptSecret,
  encryptSecret,
  loadEncryptionKey,
  redactedSuffix,
} from '@conduit/shared/crypto';

/**
 * API-side credential crypto. The shared `@conduit/shared/crypto` module
 * owns the AES-256-GCM format and key resolution; this thin wrapper just
 * binds the API's "auto-generate the key file on first use" policy.
 */
export function encryptionKey(): Buffer {
  return loadEncryptionKey({ autoGenerate: true });
}

export function encrypt(plaintext: string): string {
  return encryptSecret(plaintext, encryptionKey());
}

export function decrypt(payload: string): string {
  return decryptSecret(payload, encryptionKey());
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
