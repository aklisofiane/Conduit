import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Each case isolates module state with `vi.resetModules()` + a dynamic import
 * so the module-level `cached` buffer does not leak between tests. The env var
 * is restored after every test.
 */
async function freshLoad(): Promise<typeof import('./key.js')> {
  vi.resetModules();
  return import('./key.js');
}

describe('loadEncryptionKey', () => {
  const original = process.env.CONDUIT_ENCRYPTION_KEY;

  beforeEach(() => {
    delete process.env.CONDUIT_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CONDUIT_ENCRYPTION_KEY;
    else process.env.CONDUIT_ENCRYPTION_KEY = original;
  });

  it('uses a 64-char hex env value verbatim as a 32-byte key', async () => {
    const hex = 'a'.repeat(64);
    process.env.CONDUIT_ENCRYPTION_KEY = hex;
    const { loadEncryptionKey } = await freshLoad();

    const key = loadEncryptionKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    expect(key.equals(Buffer.from(hex, 'hex'))).toBe(true);
  });

  it('SHA-256 derives a non-hex passphrase to a 32-byte key', async () => {
    const passphrase = 'not-a-hex-string-just-a-passphrase';
    process.env.CONDUIT_ENCRYPTION_KEY = passphrase;
    const { loadEncryptionKey } = await freshLoad();

    const key = loadEncryptionKey();
    const expected = crypto.createHash('sha256').update(passphrase).digest();
    expect(key.length).toBe(32);
    expect(key.equals(expected)).toBe(true);
  });

  it('treats a 63-char hex string as a passphrase (wrong length, not hex-decoded)', async () => {
    const material = 'a'.repeat(63);
    process.env.CONDUIT_ENCRYPTION_KEY = material;
    const { loadEncryptionKey } = await freshLoad();

    const key = loadEncryptionKey();
    const expected = crypto.createHash('sha256').update(material).digest();
    expect(key.length).toBe(32);
    expect(key.equals(expected)).toBe(true);
    // Not the hex decode of the (odd-length) material.
    expect(key.equals(Buffer.from(material, 'hex'))).toBe(false);
  });

  it('treats a 65-char hex string as a passphrase (wrong length, not hex-decoded)', async () => {
    const material = 'a'.repeat(65);
    process.env.CONDUIT_ENCRYPTION_KEY = material;
    const { loadEncryptionKey } = await freshLoad();

    const key = loadEncryptionKey();
    const expected = crypto.createHash('sha256').update(material).digest();
    expect(key.length).toBe(32);
    expect(key.equals(expected)).toBe(true);
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
