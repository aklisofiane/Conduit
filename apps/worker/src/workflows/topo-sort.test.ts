import { describe, expect, it } from 'vitest';
import type { Edge } from '@conduit/shared';
import { topoSortGroups } from './topo-sort';

interface N {
  name: string;
}

const node = (name: string): N => ({ name });

describe('topoSortGroups', () => {
  it('returns no groups for empty inputs', () => {
    expect(topoSortGroups<N>([], [], [])).toEqual([]);
  });

  it('returns no groups when no entries are provided', () => {
    expect(topoSortGroups<N>([node('A')], [], [])).toEqual([]);
  });

  it('schedules an entry with no agent edges as a single group', () => {
    expect(topoSortGroups<N>([node('A')], [], ['A'])).toEqual([[node('A')]]);
  });

  it('walks downstream from an entry through agent edges', () => {
    const nodes = [node('A'), node('B'), node('C')];
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ];
    expect(topoSortGroups<N>(nodes, edges, ['A'])).toEqual([[node('A')], [node('B')], [node('C')]]);
  });

  it('groups parallel siblings into the same bucket', () => {
    const nodes = [node('Seed'), node('Dev'), node('Tests'), node('QA')];
    const edges: Edge[] = [
      { from: 'Seed', to: 'Dev' },
      { from: 'Seed', to: 'Tests' },
      { from: 'Dev', to: 'QA' },
      { from: 'Tests', to: 'QA' },
    ];
    const groups = topoSortGroups<N>(nodes, edges, ['Seed']);
    expect(groups[0]).toEqual([node('Seed')]);
    expect(groups[1]?.map((n) => n.name).sort()).toEqual(['Dev', 'Tests']);
    expect(groups[2]).toEqual([node('QA')]);
  });

  it('skips agents not reachable from any entry (orphans)', () => {
    const nodes = [node('Connected'), node('Orphan')];
    const edges: Edge[] = [];
    expect(topoSortGroups<N>(nodes, edges, ['Connected'])).toEqual([[node('Connected')]]);
  });

  it('detects a cycle in the reachable subgraph', () => {
    const nodes = [node('A'), node('B')];
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ];
    expect(() => topoSortGroups<N>(nodes, edges, ['A'])).toThrow(/cycle/);
  });

  it('ignores cycles that are entirely outside the reachable subgraph', () => {
    const nodes = [node('A'), node('B'), node('C')];
    const edges: Edge[] = [
      { from: 'B', to: 'C' },
      { from: 'C', to: 'B' },
    ];
    expect(topoSortGroups<N>(nodes, edges, ['A'])).toEqual([[node('A')]]);
  });
});
