import { describe, expect, it } from 'vitest';
import type { Edge } from './edge';
import { parallelDownstreamOf } from './parallel-downstream';

describe('parallelDownstreamOf', () => {
  const edges: Edge[] = [
    { from: 'Planner', to: 'Dev' },
    { from: 'Planner', to: 'Tests' },
    { from: 'Dev', to: 'Docs' },
  ];

  it('returns the immediate children of a fan-out node in declaration order', () => {
    expect(parallelDownstreamOf('Planner', edges)).toEqual(['Dev', 'Tests']);
  });

  it('returns empty for a single-downstream node', () => {
    expect(parallelDownstreamOf('Dev', edges)).toEqual([]);
  });

  it('returns empty for a leaf node', () => {
    expect(parallelDownstreamOf('Docs', edges)).toEqual([]);
  });

  it('does not walk transitively', () => {
    // Docs is reachable from Planner only through Dev.
    expect(parallelDownstreamOf('Planner', edges)).not.toContain('Docs');
  });
});
