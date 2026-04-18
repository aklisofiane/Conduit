import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * AES-256-GCM wrapper for PlatformCredential.secret. See docs/SECURITY.md.
 *
 * Stored format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>` — one line, no
 * schema dependencies. Prisma stores this as a plain string.
 */
const ALGO = 'aes-256-gcm';

let _key: Buffer | undefined;

export function encryptionKey(): Buffer {
  if (_key) return _key;
  const envKey = process.env.CONDUIT_ENCRYPTION_KEY;
  if (envKey) {
    _key = normalizeKey(envKey);
    return _key;
  }
  const file = path.join(os.homedir(), '.conduit', 'key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fresh = crypto.randomBytes(32);
    fs.writeFileSync(file, fresh.toString('hex'), { mode: 0o600 });
    _key = fresh;
    return _key;
  }
  _key = normalizeKey(fs.readFileSync(file, 'utf8').trim());
  return _key;
}

function normalizeKey(material: string): Buffer {
  const hex = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  // Derive via SHA-256 if a raw passphrase was provided — keeps self-host users happy.
  return crypto.createHash('sha256').update(hex).digest();
}

export function encrypt(plaintext: string): string {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, ctHex] = payload.split(':');
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error('Malformed encrypted credential payload');
  }
  const key = encryptionKey();
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
