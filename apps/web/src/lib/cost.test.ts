import { describe, expect, it } from 'vitest';
import { formatTokens, formatUsd } from './cost.js';

describe('formatUsd', () => {
  it('renders sub-dollar amounts with four decimals', () => {
    expect(formatUsd(0.0123)).toBe('$0.0123');
    expect(formatUsd(0.5)).toBe('$0.5000');
  });

  it('renders dollar amounts with two decimals', () => {
    expect(formatUsd(1.2)).toBe('$1.20');
    expect(formatUsd(42)).toBe('$42.00');
  });

  it('renders exact zero as two decimals', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('renders null/undefined as an em dash', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
  });
});

describe('formatTokens', () => {
  it('adds thousands separators', () => {
    expect(formatTokens(12345)).toBe('12,345');
    expect(formatTokens(0)).toBe('0');
  });

  it('renders null/undefined as an em dash', () => {
    expect(formatTokens(null)).toBe('—');
    expect(formatTokens(undefined)).toBe('—');
  });
});
