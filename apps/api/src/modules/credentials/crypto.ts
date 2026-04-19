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

export { redactedSuffix };
