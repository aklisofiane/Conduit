import {
  decryptSecret,
  encryptSecret,
  loadEncryptionKey,
  redactedSuffix,
} from '@conduit/shared/crypto';

/**
 * Thin wrapper around `@conduit/shared/crypto` that binds the API's
 * "auto-generate the key file on first use" policy. Identical envelope
 * format to `credentials/crypto.ts` so a future audit of the at-rest
 * format only has to look at one shape.
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
