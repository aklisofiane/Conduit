import { describe, expect, it } from 'vitest';
import { capTriggerBody } from './event';

const DEFAULT_CAP = 64 * 1024;

describe('capTriggerBody', () => {
  it('returns body unchanged when under cap', () => {
    const body = 'short body';
    expect(capTriggerBody(body)).toBe(body);
  });

  it('returns body unchanged when exactly at cap', () => {
    const body = 'x'.repeat(DEFAULT_CAP);
    expect(capTriggerBody(body)).toBe(body);
  });

  it('truncates body over cap with suffix', () => {
    const body = 'a'.repeat(DEFAULT_CAP + 100);
    const result = capTriggerBody(body);
    const suffix = '\n\n[truncated]';
    expect(result).toBe('a'.repeat(DEFAULT_CAP) + suffix);
    expect(result.length).toBe(DEFAULT_CAP + suffix.length);
  });

  it('returns empty string unchanged', () => {
    expect(capTriggerBody('')).toBe('');
  });

  it('respects custom max parameter', () => {
    const body = 'abcdefghijklmnopqrst'; // 20 chars
    const result = capTriggerBody(body, 10);
    expect(result).toBe('abcdefghij\n\n[truncated]');
  });
});
