import { describe, expect, it } from 'vitest';
import type { Edge } from './edge';
import { directUpstreamOf } from './direct-upstream';

describe('directUpstreamOf', () => {
  const edges: Edge[] = [
    { from: 'Scope', to: 'Reviewer' },
    { from: 'Reviewer', to: 'Publisher' },
    { from: 'Tests', to: 'Publisher' },
  ];

  it('returns the single immediate predecessor of a node', () => {
    expect(directUpstreamOf('Reviewer', edges)).toEqual(['Scope']);
  });

  it('returns all predecessors of a fan-in node in declaration order', () => {
    expect(directUpstreamOf('Publisher', edges)).toEqual(['Reviewer', 'Tests']);
  });

  it('returns empty for an entry node with no upstream', () => {
    expect(directUpstreamOf('Scope', edges)).toEqual([]);
  });

  it('does not walk transitively', () => {
    // Scope is upstream of Publisher only through Reviewer.
    expect(directUpstreamOf('Publisher', edges)).not.toContain('Scope');
  });
});
