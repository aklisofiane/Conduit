import { describe, expect, it } from 'vitest';
import { formatParallelDownstreamBlock } from './context';

describe('formatParallelDownstreamBlock', () => {
  it('returns empty string when there are no downstream siblings', () => {
    expect(formatParallelDownstreamBlock([])).toBe('');
  });

  it('returns empty string when there is a single downstream node', () => {
    // Single downstream is not a fan-out — no auto-injection so non-planner
    // agents stay clean.
    expect(formatParallelDownstreamBlock(['Dev'])).toBe('');
  });

  it('renders a labeled section with bulleted siblings on fan-out', () => {
    const out = formatParallelDownstreamBlock(['Dev', 'Tests']);
    expect(out).toContain('## Parallel downstream');
    expect(out).toContain('- Dev');
    expect(out).toContain('- Tests');
    expect(out).toContain('branched worktrees');
    expect(out).toContain('.conduit/');
  });

  it('preserves caller-supplied sibling order', () => {
    const out = formatParallelDownstreamBlock(['Tests', 'Dev']);
    const ti = out.indexOf('- Tests');
    const di = out.indexOf('- Dev');
    expect(ti).toBeGreaterThan(-1);
    expect(di).toBeGreaterThan(ti);
  });
});
