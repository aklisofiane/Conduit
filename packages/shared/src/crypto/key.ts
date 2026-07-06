import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolve the encryption key(s) shared by API and worker. Material order:
 *   1. `CONDUIT_ENCRYPTION_KEY` (64-hex used verbatim, anything else treated
 *      as a passphrase and scrypt-derived).
 *   2. `~/.conduit/key` (auto-created on first call when `autoGenerate`).
 * Workers should pass `autoGenerate: false` so a missing key surfaces
 * loudly instead of producing an unrecoverable random key. Hosted API
 * deployments require explicit 64-hex material — enforced at boot by the
 * API's `assertHostedSafety`.
 */

export interface LoadEncryptionKeyOptions {
  autoGenerate?: boolean;
}

export interface EncryptionKeys {
  /** Key for all new encryption: hex material verbatim, or scrypt-derived from a passphrase. */
  primary: Buffer;
  /**
   * Pre-scrypt derivation (single-pass SHA-256) of the same passphrase.
   * Decrypt-only fallback for payloads written before the KDF upgrade —
   * never used to encrypt, so legacy ciphertexts migrate to the scrypt key
   * whenever they are next written. Absent when the material is a hex key.
   */
  legacy?: Buffer;
}

let cached: EncryptionKeys | undefined;

export function loadEncryptionKeys(opts: LoadEncryptionKeyOptions = {}): EncryptionKeys {
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
    cached = { primary: fresh };
    return cached;
  }
  cached = normalizeKey(fs.readFileSync(file, 'utf8').trim());
  return cached;
}

export function loadEncryptionKey(opts: LoadEncryptionKeyOptions = {}): Buffer {
  return loadEncryptionKeys(opts).primary;
}

// Node's default scrypt cost, pinned explicitly so the derived key can't
// silently change under a future Node default bump (which would make every
// stored credential undecryptable).
const SCRYPT_COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function normalizeKey(material: string): EncryptionKeys {
  const hex = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return { primary: Buffer.from(hex, 'hex') };
  // Passphrase (self-host convenience): scrypt over a per-install random
  // salt, so a low-entropy passphrase can't be brute-forced with a single
  // hash pass and precomputed tables don't transfer between installs.
  return {
    primary: crypto.scryptSync(hex, loadOrCreateSalt(), 32, SCRYPT_COST),
    legacy: crypto.createHash('sha256').update(hex).digest(),
  };
}

/**
 * Per-install random salt for passphrase-mode scrypt. Lives under
 * `CONDUIT_HOME ?? ~/.conduit` (the workspace-layer convention); the key
 * file above stays hardcoded to `~/.conduit/key` so existing installs keep
 * finding their key. The salt is not secret — it only defeats precomputed
 * tables — so it is auto-created regardless of `autoGenerate`; `wx` + a
 * re-read settles two processes racing to create it at first boot on the
 * winner's salt.
 */
function loadOrCreateSalt(): Buffer {
  const dir = process.env.CONDUIT_HOME ?? path.join(os.homedir(), '.conduit');
  const file = path.join(dir, 'key.salt');
  const existing = readSalt(file);
  if (existing) return existing;
  fs.mkdirSync(dir, { recursive: true });
  const fresh = crypto.randomBytes(16);
  try {
    fs.writeFileSync(file, fresh.toString('hex'), { mode: 0o600, flag: 'wx' });
    return fresh;
  } catch {
    const winner = readSalt(file);
    if (winner) return winner;
    throw new Error(`Failed to create scrypt salt at ${file}.`);
  }
}

function readSalt(file: string): Buffer | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8').trim();
  } catch {
    return undefined;
  }
  if (!/^[0-9a-fA-F]{32}$/.test(text)) {
    // Refuse to regenerate over a corrupt salt — a fresh salt derives a
    // different key and silently orphans every stored credential.
    throw new Error(`Corrupt scrypt salt at ${file} — expected 32 hex chars.`);
  }
  return Buffer.from(text, 'hex');
}
