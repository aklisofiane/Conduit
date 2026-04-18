import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolve the encryption key shared by API and worker. Order:
 *   1. `CONDUIT_ENCRYPTION_KEY` (hex or passphrase, auto-derived).
 *   2. `~/.conduit/key` (auto-created on first call when `autoGenerate`).
 * Workers should pass `autoGenerate: false` so a missing key surfaces
 * loudly instead of producing an unrecoverable random key.
 */
let cached: Buffer | undefined;

export interface LoadEncryptionKeyOptions {
  autoGenerate?: boolean;
}

export function loadEncryptionKey(opts: LoadEncryptionKeyOptions = {}): Buffer {
  if (cached) return cached;
  const envKey = process.env.CONDUIT_ENCRYPTION_KEY;
  if (envKey) {
    cached = normalizeKey(envKey);
    return cached;
  }
  const file = path.join(os.homedir(), '.conduit', 'key');
  if (!fs.existsSync(file)) {
    if (!opts.autoGenerate) {
      throw new Error(
        `No encryption key found. Set CONDUIT_ENCRYPTION_KEY or write a key to ${file}.`,
      );
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fresh = crypto.randomBytes(32);
    fs.writeFileSync(file, fresh.toString('hex'), { mode: 0o600 });
    cached = fresh;
    return cached;
  }
  cached = normalizeKey(fs.readFileSync(file, 'utf8').trim());
  return cached;
}

function normalizeKey(material: string): Buffer {
  const hex = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  // Derive via SHA-256 if a raw passphrase was provided — keeps self-host users happy.
  return crypto.createHash('sha256').update(hex).digest();
}
