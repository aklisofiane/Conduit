import { describe, expect, it } from 'vitest';
import { formatParallelDownstreamBlock, formatUpstreamContextBlock } from './context';

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

describe('formatUpstreamContextBlock', () => {
  it('returns empty string when there are no upstream summaries', () => {
    expect(formatUpstreamContextBlock([])).toBe('');
  });

  it('renders a single predecessor under the Upstream context heading', () => {
    const out = formatUpstreamContextBlock([
      { nodeName: 'Scope', body: 'Routed reviewers to src/checkout.\n' },
    ]);
    expect(out).toContain('## Upstream context');
    expect(out).toContain('### Scope');
    expect(out).toContain('Routed reviewers to src/checkout.');
  });

  it('renders one subsection per predecessor in input order, bodies verbatim', () => {
    const out = formatUpstreamContextBlock([
      { nodeName: 'Reviewer', body: 'Found a null-deref.' },
      { nodeName: 'Tests', body: 'Coverage dropped 2%.' },
    ]);
    expect(out).toContain('### Reviewer');
    expect(out).toContain('### Tests');
    expect(out).toContain('Found a null-deref.');
    expect(out).toContain('Coverage dropped 2%.');
    // Edge-declaration order is preserved.
    expect(out.indexOf('### Reviewer')).toBeLessThan(out.indexOf('### Tests'));
    // Body is reproduced exactly, not reflowed or escaped.
    expect(out).toContain('### Reviewer\n\nFound a null-deref.');
  });
});
