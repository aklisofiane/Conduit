import crypto from 'node:crypto';

/**
 * AES-256-GCM helpers used by both the API (which encrypts at credential
 * write time) and the worker (which decrypts at run time). The on-disk
 * payload is a single string `<iv_hex>:<authTag_hex>:<ciphertext_hex>` so
 * Prisma stores it as a plain column without a schema dependency.
 *
 * See docs/SECURITY.md.
 */
const ALGO = 'aes-256-gcm';

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [ivHex, tagHex, ctHex] = payload.split(':');
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error('Malformed encrypted credential payload');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Last 4 characters of the plaintext — for UI displays like `sk-ant-…4f2a`. */
export function redactedSuffix(plaintext: string): string {
  if (plaintext.length <= 4) return '****';
  return plaintext.slice(-4);
}
