import { describe, expect, it } from 'vitest';
import {
  formatParallelDownstreamBlock,
  formatUpstreamContextBlock,
  issueWritebackPrompt,
} from './context';

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

describe('issueWritebackPrompt', () => {
  it('anchors to the triggering issue when issueNumber is set', () => {
    const out = issueWritebackPrompt({
      owner: 'acme',
      repo: 'web',
      issueNumber: '42',
      allowedStatuses: ['AIDev', 'HumanReview'],
      allowedLabels: ['bug'],
    });
    expect(out).toContain('the GitHub issue this run was triggered by');
    expect(out).toContain('Issue: acme/web#42');
    expect(out).toContain('"AIDev"');
    expect(out).toContain('"HumanReview"');
    expect(out).toContain('"bug"');
    expect(out).toContain("skip the update — don't pick a default");
  });

  it('is repo-scoped when issueNumber is omitted (cron run)', () => {
    const out = issueWritebackPrompt({
      owner: 'acme',
      repo: 'web',
      allowedStatuses: ['AIDev', 'HumanReview'],
      allowedLabels: [],
    });
    // No fixed issue — addresses whatever the agent creates/touches.
    expect(out).not.toContain('Issue: acme/web#');
    expect(out).toContain('every GitHub issue you created or updated in acme/web');
    expect(out).toContain('"AIDev"');
    expect(out).toContain("If you didn't create or update any issue, skip this");
  });

  it('omits the status constraint when no statuses are allowed', () => {
    const out = issueWritebackPrompt({
      owner: 'acme',
      repo: 'web',
      allowedStatuses: [],
      allowedLabels: ['triage'],
    });
    expect(out).not.toContain('project Status');
    expect(out).toContain('"triage"');
  });
});
