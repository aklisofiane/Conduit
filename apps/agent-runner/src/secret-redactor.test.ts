import { describe, expect, it } from 'vitest';
import { createSecretRedactor } from './secret-redactor';

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

describe('secret redactor', () => {
  it('returns undefined when there is nothing worth redacting', () => {
    expect(createSecretRedactor([])).toBeUndefined();
    // Short values are skipped — matching them would over-redact benign content.
    expect(createSecretRedactor([{ label: 'X', value: '1' }])).toBeUndefined();
  });

  it('redacts a secret substring inside a plain string', () => {
    const r = createSecretRedactor([{ label: 'ANTHROPIC_API_KEY', value: KEY }])!;
    expect(r.redactString(`auth: Bearer ${KEY} done`)).toBe(
      'auth: Bearer [redacted:ANTHROPIC_API_KEY] done',
    );
  });

  it('deep-redacts secrets in nested object values and keys', () => {
    const r = createSecretRedactor([{ label: 'TOKEN', value: KEY }])!;
    const redacted = r.redactValue({
      headers: { authorization: `Bearer ${KEY}` },
      list: ['safe', KEY],
      [KEY]: 'used-as-key',
    }) as Record<string, unknown>;
    expect(redacted).toEqual({
      headers: { authorization: 'Bearer [redacted:TOKEN]' },
      list: ['safe', '[redacted:TOKEN]'],
      '[redacted:TOKEN]': 'used-as-key',
    });
  });

  it('preserves reference identity when nothing matched', () => {
    const r = createSecretRedactor([{ label: 'TOKEN', value: KEY }])!;
    const clean = { status: 'ok', items: [1, 2, 3] };
    expect(r.redactValue(clean)).toBe(clean);
    const s = 'no secrets here';
    expect(r.redactString(s)).toBe(s);
  });

  it('redacts the JSON-escaped form too (e.g. in an oversized payload preview)', () => {
    const value = 'a"b\\c'.repeat(2); // contains chars JSON escapes
    const r = createSecretRedactor([{ label: 'EXTRA', value: 'a"b\\ca"b\\c' }])!;
    // Mimics a slice of JSON.stringify, where the secret appears escaped.
    const previewSlice = JSON.stringify({ v: value }).slice(1, -1);
    expect(r.redactString(previewSlice)).toContain('[redacted:EXTRA]');
  });

  it('redacts the longest overlapping secret first', () => {
    const r = createSecretRedactor([
      { label: 'SHORT', value: 'abcdefgh' },
      { label: 'LONG', value: 'abcdefghijklmnop' },
    ])!;
    expect(r.redactString('abcdefghijklmnop')).toBe('[redacted:LONG]');
  });
});
