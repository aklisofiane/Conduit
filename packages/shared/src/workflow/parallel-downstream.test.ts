import { describe, expect, it } from 'vitest';
import type { Edge } from './edge';
import { directDownstreamOf, parallelDownstreamOf } from './parallel-downstream';

describe('directDownstreamOf', () => {
  const edges: Edge[] = [
    { from: 'Trigger', to: 'Planner' },
    { from: 'Planner', to: 'Dev' },
    { from: 'Planner', to: 'Tests' },
    { from: 'Dev', to: 'Docs' },
    { from: 'Tests', to: 'Docs' },
    { from: 'Docs', to: 'QA' },
  ];

  it('returns the immediate children of a fan-out node in declaration order', () => {
    expect(directDownstreamOf('Planner', edges)).toEqual(['Dev', 'Tests']);
  });

  it('returns the single child of a non-fan-out node', () => {
    expect(directDownstreamOf('Docs', edges)).toEqual(['QA']);
  });

  it('returns empty for a leaf node', () => {
    expect(directDownstreamOf('QA', edges)).toEqual([]);
  });

  it('does not walk transitively', () => {
    // QA is reachable from Planner but only through Dev/Tests/Docs.
    expect(directDownstreamOf('Planner', edges)).not.toContain('QA');
  });
});

describe('parallelDownstreamOf', () => {
  const edges: Edge[] = [
    { from: 'Planner', to: 'Dev' },
    { from: 'Planner', to: 'Tests' },
    { from: 'Dev', to: 'Docs' },
  ];

  it('returns the children only when there are >1 (fan-out)', () => {
    expect(parallelDownstreamOf('Planner', edges)).toEqual(['Dev', 'Tests']);
  });

  it('returns empty for a single-downstream node', () => {
    expect(parallelDownstreamOf('Dev', edges)).toEqual([]);
  });

  it('returns empty for a leaf node', () => {
    expect(parallelDownstreamOf('Docs', edges)).toEqual([]);
  });
});
