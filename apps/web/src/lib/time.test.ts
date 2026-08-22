import { describe, expect, it } from 'vitest';
import { relativeFromNow, relativeUntil } from './time.js';

const NOW = Date.parse('2026-08-22T12:00:00.000Z');

describe('relativeUntil', () => {
  it('formats future instants at minute, hour and day granularity', () => {
    expect(relativeUntil('2026-08-22T12:00:30.000Z', NOW)).toBe('in under a minute');
    expect(relativeUntil('2026-08-22T12:42:00.000Z', NOW)).toBe('in 42m');
    expect(relativeUntil('2026-08-22T15:00:00.000Z', NOW)).toBe('in 3h');
    expect(relativeUntil('2026-08-28T12:00:00.000Z', NOW)).toBe('in 6d');
  });

  it('collapses past instants to "now" — the staleness hint owns that case', () => {
    expect(relativeUntil('2026-08-22T11:00:00.000Z', NOW)).toBe('now');
    expect(relativeUntil(new Date(NOW), NOW)).toBe('now');
  });

  it('renders a dash for a missing value', () => {
    expect(relativeUntil(null)).toBe('—');
    expect(relativeUntil(undefined)).toBe('—');
  });
});

describe('relativeFromNow', () => {
  it('accepts an injected reference instant', () => {
    expect(relativeFromNow('2026-08-22T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(relativeFromNow(new Date(NOW), NOW)).toBe('just now');
  });
});
