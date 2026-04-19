import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGithubSignature } from './signature';

function signed(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyGithubSignature', () => {
  const secret = 'shh-super-secret';
  const body = '{"hello":"world"}';

  it('accepts a valid signature', () => {
    expect(verifyGithubSignature(secret, body, signed(secret, body))).toBe(true);
  });

  it('accepts when body is passed as a Buffer', () => {
    expect(verifyGithubSignature(secret, Buffer.from(body), signed(secret, body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = signed(secret, body);
    expect(verifyGithubSignature(secret, body + ' ', sig)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(verifyGithubSignature('different', body, signed(secret, body))).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyGithubSignature(secret, body, undefined)).toBe(false);
  });

  it('rejects a non-hex header', () => {
    expect(verifyGithubSignature(secret, body, 'sha256=not-hex!!!')).toBe(false);
  });

  it('rejects when sha256= prefix is absent and digest has wrong length', () => {
    expect(verifyGithubSignature(secret, body, 'deadbeef')).toBe(false);
  });

  it('is case-insensitive on the hex digest', () => {
    const sig = signed(secret, body).toUpperCase();
    expect(verifyGithubSignature(secret, body, sig)).toBe(true);
  });
});
