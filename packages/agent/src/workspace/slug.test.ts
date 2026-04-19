import { describe, expect, it } from 'vitest';
import { deriveSlug, formatBranchName } from './slug';

describe('deriveSlug', () => {
  it('lowercases and replaces non-alphanumerics with dashes', () => {
    expect(deriveSlug('Fix crash in checkout')).toBe('fix-crash-in-checkout');
  });

  it('collapses repeated separators and strips leading/trailing dashes', () => {
    expect(deriveSlug('   Multiple   spaces // and punctuation!!! ')).toBe(
      'multiple-spaces-and-punctuation',
    );
  });

  it('truncates to the max length without leaving a trailing dash', () => {
    const long = 'aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhhh';
    // 39 chars, no dash at the cut point
    expect(deriveSlug(long, 20)).toBe('aaaa-bbbb-cccc-dddd');
    expect(deriveSlug('word-word-word-word-word', 10)).toBe('word-word');
  });

  it('falls back to a default token when the title is empty after normalization', () => {
    expect(deriveSlug('')).toBe('ticket');
    expect(deriveSlug('!!!')).toBe('ticket');
  });
});

describe('formatBranchName', () => {
  it('produces the conduit/<id>-<slug> shape', () => {
    expect(formatBranchName('42', 'fix-crash')).toBe('conduit/42-fix-crash');
    expect(formatBranchName('PROJ-123', 'ship-it')).toBe('conduit/PROJ-123-ship-it');
  });
});
