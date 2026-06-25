import { describe, expect, it } from 'vitest';
import {
  CONDUIT_LABELS,
  getConduitLabel,
  isConduitLabel,
} from './index';

describe('CONDUIT_LABELS registry', () => {
  it('contains the four canonical labels', () => {
    expect(CONDUIT_LABELS.map((l) => l.name)).toEqual([
      'conduit-dev',
      'conduit-review',
      'conduit-merge',
      'conduit-human-review',
    ]);
  });

  it('uses 6-digit hex colors without a leading #', () => {
    for (const label of CONDUIT_LABELS) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
    }
  });

  it('gives every label a non-empty description', () => {
    for (const label of CONDUIT_LABELS) {
      expect(label.description.length).toBeGreaterThan(0);
    }
  });
});

describe('isConduitLabel', () => {
  it('matches known Conduit labels exactly', () => {
    expect(isConduitLabel('conduit-dev')).toBe(true);
    expect(isConduitLabel('conduit-human-review')).toBe(true);
  });

  it('rejects unknown and near-miss labels', () => {
    expect(isConduitLabel('review')).toBe(false);
    expect(isConduitLabel('Review')).toBe(false);
    expect(isConduitLabel('conduit-dev ')).toBe(false);
    expect(isConduitLabel('')).toBe(false);
  });
});

describe('getConduitLabel', () => {
  it('returns the registry entry for a known label', () => {
    expect(getConduitLabel('conduit-merge')).toMatchObject({
      name: 'conduit-merge',
    });
  });

  it('returns undefined for an unknown label', () => {
    expect(getConduitLabel('bug')).toBeUndefined();
  });
});
