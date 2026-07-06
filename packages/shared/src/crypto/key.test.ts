import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Each case isolates module state with `vi.resetModules()` + a dynamic import
 * so the module-level `cached` keys do not leak between tests. Passphrase
 * cases point `CONDUIT_HOME` at a tmpdir so the scrypt salt lands there, not
 * in the real `~/.conduit`. Env vars are restored after every test.
 */
async function freshLoad(): Promise<typeof import('./key.js')> {
  vi.resetModules();
  return import('./key.js');
}

const SCRYPT_COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

describe('loadEncryptionKeys', () => {
  const originalKey = process.env.CONDUIT_ENCRYPTION_KEY;
  const originalHome = process.env.CONDUIT_HOME;
  let conduitHome: string;

  beforeEach(async () => {
    delete process.env.CONDUIT_ENCRYPTION_KEY;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-key-'));
    process.env.CONDUIT_HOME = conduitHome;
  });

  afterEach(async () => {
    if (originalKey === undefined) delete process.env.CONDUIT_ENCRYPTION_KEY;
    else process.env.CONDUIT_ENCRYPTION_KEY = originalKey;
    if (originalHome === undefined) delete process.env.CONDUIT_HOME;
    else process.env.CONDUIT_HOME = originalHome;
    await fs.rm(conduitHome, { recursive: true, force: true });
  });

  async function saltAt(file = 'key.salt'): Promise<Buffer> {
    const text = (await fs.readFile(path.join(conduitHome, file), 'utf8')).trim();
    return Buffer.from(text, 'hex');
  }

  it('uses a 64-char hex env value verbatim as a 32-byte key, with no legacy fallback', async () => {
    const hex = 'a'.repeat(64);
    process.env.CONDUIT_ENCRYPTION_KEY = hex;
    const { loadEncryptionKeys, loadEncryptionKey } = await freshLoad();

    const keys = loadEncryptionKeys();
    expect(keys.primary.equals(Buffer.from(hex, 'hex'))).toBe(true);
    expect(keys.legacy).toBeUndefined();
    expect(loadEncryptionKey().equals(keys.primary)).toBe(true);
  });

  it('scrypt-derives a passphrase against a persisted per-install salt', async () => {
    const passphrase = 'not-a-hex-string-just-a-passphrase';
    process.env.CONDUIT_ENCRYPTION_KEY = passphrase;
    const { loadEncryptionKeys } = await freshLoad();

    const keys = loadEncryptionKeys();
    const salt = await saltAt();
    expect(salt.length).toBe(16);
    const expected = crypto.scryptSync(passphrase, salt, 32, SCRYPT_COST);
    expect(keys.primary.equals(expected)).toBe(true);
    // No longer the weak single-pass digest…
    const sha = crypto.createHash('sha256').update(passphrase).digest();
    expect(keys.primary.equals(sha)).toBe(false);
    // …which survives only as the decrypt-only legacy fallback.
    expect(keys.legacy?.equals(sha)).toBe(true);
  });

  it('derives the same key across process restarts (salt is stable)', async () => {
    process.env.CONDUIT_ENCRYPTION_KEY = 'self-host-passphrase';
    const first = (await freshLoad()).loadEncryptionKeys();
    const second = (await freshLoad()).loadEncryptionKeys();
    expect(second.primary.equals(first.primary)).toBe(true);
  });

  it('treats 63- and 65-char hex strings as passphrases (wrong length, not hex-decoded)', async () => {
    for (const material of ['a'.repeat(63), 'a'.repeat(65)]) {
      process.env.CONDUIT_ENCRYPTION_KEY = material;
      const { loadEncryptionKeys } = await freshLoad();
      const keys = loadEncryptionKeys();
      expect(keys.primary.length).toBe(32);
      expect(keys.legacy).toBeDefined();
      expect(keys.primary.equals(Buffer.from(material, 'hex'))).toBe(false);
    }
  });

  it('refuses a corrupt salt file instead of silently deriving a divergent key', async () => {
    await fs.writeFile(path.join(conduitHome, 'key.salt'), 'not-hex-at-all');
    process.env.CONDUIT_ENCRYPTION_KEY = 'some passphrase';
    const { loadEncryptionKeys } = await freshLoad();
    expect(() => loadEncryptionKeys()).toThrow(/Corrupt scrypt salt/);
  });

  it('produces a key that roundtrips through encryptSecret/decryptSecret', async () => {
    process.env.CONDUIT_ENCRYPTION_KEY = 'self-host-passphrase';
    const { loadEncryptionKey } = await freshLoad();
    const { encryptSecret, decryptSecret } = await import('./aes-gcm.js');

    const key = loadEncryptionKey();
    const secret = 'sk-ant-super-secret-value-4f2a';
    const payload = encryptSecret(secret, key);
    expect(decryptSecret(payload, key)).toBe(secret);
  });

  it('decrypts pre-scrypt payloads via the legacy fallback', async () => {
    const passphrase = 'self-host-passphrase';
    process.env.CONDUIT_ENCRYPTION_KEY = passphrase;
    const { loadEncryptionKeys } = await freshLoad();
    const { encryptSecret, decryptSecretWithFallback } = await import('./aes-gcm.js');

    // Simulate a credential written before the KDF upgrade: encrypted under
    // the old single-pass SHA-256 key.
    const oldKey = crypto.createHash('sha256').update(passphrase).digest();
    const payload = encryptSecret('legacy-secret', oldKey);
    expect(decryptSecretWithFallback(payload, loadEncryptionKeys())).toBe('legacy-secret');
  });

  it('caches the first key and ignores later env changes within the same module instance', async () => {
    process.env.CONDUIT_ENCRYPTION_KEY = 'b'.repeat(64);
    const { loadEncryptionKey } = await freshLoad();

    const first = loadEncryptionKey();
    process.env.CONDUIT_ENCRYPTION_KEY = 'c'.repeat(64);
    const second = loadEncryptionKey();

    expect(second).toBe(first);
    expect(second.equals(Buffer.from('b'.repeat(64), 'hex'))).toBe(true);
  });
});
