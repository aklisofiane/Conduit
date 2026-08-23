import { describe, expect, it } from 'vitest';
import { branchPickerOptions } from './CronTriggerPanel.js';

describe('branchPickerOptions', () => {
  it('surfaces the fetched remote branches as the picker suggestions', () => {
    expect(branchPickerOptions(['main', 'develop', 'release/2.0'], '')).toEqual([
      'main',
      'develop',
      'release/2.0',
    ]);
  });

  it('keeps a typed value that is not in the fetched list (free-entry fallback)', () => {
    expect(branchPickerOptions(['main', 'develop'], 'feature/just-pushed')).toEqual([
      'feature/just-pushed',
      'main',
      'develop',
    ]);
  });

  it('does not duplicate a typed value that is already a fetched branch', () => {
    expect(branchPickerOptions(['main', 'develop'], 'develop')).toEqual(['main', 'develop']);
  });

  it('still offers a typed value when the branch list failed to load (empty)', () => {
    expect(branchPickerOptions([], 'branch-2')).toEqual(['branch-2']);
  });

  it('ignores a blank / whitespace-only typed value', () => {
    expect(branchPickerOptions(['main'], '   ')).toEqual(['main']);
  });
});
