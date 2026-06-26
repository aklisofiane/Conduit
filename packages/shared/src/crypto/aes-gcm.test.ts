import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, redactedSuffix } from './aes-gcm';

const key = crypto.randomBytes(32);

describe('encryptSecret / decryptSecret', () => {
  it('roundtrips a plaintext back to the original', () => {
    const plaintext = 'sk-ant-super-secret-value';
    const payload = encryptSecret(plaintext, key);
    expect(decryptSecret(payload, key)).toBe(plaintext);
  });

  it('roundtrips unicode/multibyte content', () => {
    const plaintext = 'héllo-🌍-世界-secret';
    const payload = encryptSecret(plaintext, key);
    expect(decryptSecret(payload, key)).toBe(plaintext);
  });

  it('produces a 3-part <hex>:<hex>:<hex> payload', () => {
    const payload = encryptSecret('abc123', key);
    const parts = payload.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('uses a fresh IV so two encryptions of the same plaintext differ', () => {
    const plaintext = 'same-input-every-time';
    const a = encryptSecret(plaintext, key);
    const b = encryptSecret(plaintext, key);
    expect(a).not.toBe(b);
    // Both still decrypt back to the same plaintext.
    expect(decryptSecret(a, key)).toBe(plaintext);
    expect(decryptSecret(b, key)).toBe(plaintext);
  });
});

describe('decryptSecret rejection paths', () => {
  it("throws 'Malformed encrypted credential payload' for fewer than 3 parts", () => {
    expect(() => decryptSecret('abc', key)).toThrow('Malformed encrypted credential payload');
    expect(() => decryptSecret('ab:cd', key)).toThrow('Malformed encrypted credential payload');
  });

  it('throws when the authTag segment is tampered (GCM integrity check)', () => {
    const payload = encryptSecret('integrity-protected', key);
    const [ivHex, tagHex, ctHex] = payload.split(':') as [string, string, string];
    // Flip a single hex char in the auth tag.
    const flipped = (tagHex[0] === 'a' ? 'b' : 'a') + tagHex.slice(1);
    const tampered = `${ivHex}:${flipped}:${ctHex}`;
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('throws when decrypting with a different key', () => {
    const payload = encryptSecret('wrong-key-test', key);
    const otherKey = crypto.randomBytes(32);
    expect(() => decryptSecret(payload, otherKey)).toThrow();
  });
});

describe('redactedSuffix', () => {
  it('returns the last 4 chars for a long secret', () => {
    expect(redactedSuffix('sk-ant-abcd4f2a')).toBe('4f2a');
  });

  it("returns '****' for inputs of length <= 4 (boundary at exactly 4)", () => {
    expect(redactedSuffix('abcd')).toBe('****');
    expect(redactedSuffix('ab')).toBe('****');
    expect(redactedSuffix('')).toBe('****');
  });

  it('returns the last 4 chars at length 5 (just past the boundary)', () => {
    expect(redactedSuffix('abcde')).toBe('bcde');
  });
});
