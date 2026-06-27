import { describe, expect, it } from 'vitest';
import { parseBaseMarker } from './base-marker';

describe('parseBaseMarker', () => {
  it('returns the branch named in the marker', () => {
    expect(parseBaseMarker('<!-- conduit:base=branch-2 -->')).toBe('branch-2');
  });

  it('returns undefined when the marker is absent', () => {
    expect(parseBaseMarker('just an ordinary issue body')).toBeUndefined();
  });

  it('returns undefined for an empty or missing body', () => {
    expect(parseBaseMarker('')).toBeUndefined();
    expect(parseBaseMarker(undefined)).toBeUndefined();
  });

  it('preserves slashes and dots in branch names', () => {
    expect(parseBaseMarker('<!-- conduit:base=release/2.0 -->')).toBe('release/2.0');
  });

  it('parses the marker when embedded inside the conduit block and surrounding text', () => {
    const body = [
      '<!-- conduit:start -->',
      '<!-- conduit:base=feature/x -->',
      'Some issue body here.',
      '<!-- conduit:end -->',
    ].join('\n');
    expect(parseBaseMarker(body)).toBe('feature/x');
  });

  it('returns the first marker when several are present', () => {
    const body = '<!-- conduit:base=first --> ... <!-- conduit:base=second -->';
    expect(parseBaseMarker(body)).toBe('first');
  });

  it('tolerates loose whitespace inside the comment', () => {
    expect(parseBaseMarker('<!--   conduit:base=branch-2   -->')).toBe('branch-2');
  });

  it('returns undefined for a malformed marker with no value', () => {
    expect(parseBaseMarker('<!-- conduit:base= -->')).toBeUndefined();
  });
});
