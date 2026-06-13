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
      platform: 'github',
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
    // Writeback runs through the attached GitHub MCP server, never the
    // unauthenticated gh CLI baked into the runner image.
    expect(out).toContain('GitHub MCP tools');
    expect(out).not.toContain('gh CLI');
    expect(out).not.toContain('gh pr');
  });

  it('is repo-scoped when issueNumber is omitted (cron run)', () => {
    const out = issueWritebackPrompt({
      platform: 'github',
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
      platform: 'github',
      owner: 'acme',
      repo: 'web',
      allowedStatuses: [],
      allowedLabels: ['triage'],
    });
    expect(out).not.toContain('project Status');
    expect(out).toContain('"triage"');
  });

  it('instructs removal of the consumed (trigger) label and application of the next one', () => {
    const out = issueWritebackPrompt({
      platform: 'github',
      owner: 'acme',
      repo: 'web',
      issueNumber: '42',
      allowedStatuses: ['Review'],
      allowedLabels: ['conduit-review'],
      consumedLabels: ['conduit-dev'],
    });
    // Removes the gating label, applies the next.
    expect(out).toContain('Remove the label that gated this run');
    expect(out).toContain('"conduit-dev"');
    expect(out).toContain('"conduit-review"');
  });

  it('has no removal directive when nothing was consumed (status-gated entry)', () => {
    const out = issueWritebackPrompt({
      platform: 'github',
      owner: 'acme',
      repo: 'web',
      issueNumber: '7',
      allowedStatuses: [],
      allowedLabels: ['conduit-dev'],
      consumedLabels: [],
    });
    expect(out).not.toContain('Remove the label that gated this run');
    expect(out).toContain('"conduit-dev"');
  });

  it('can remove a consumed label even when nothing new is applied (terminal clear)', () => {
    const out = issueWritebackPrompt({
      platform: 'github',
      owner: 'acme',
      repo: 'web',
      issueNumber: '9',
      allowedStatuses: ['ReadyToMerge', 'In Progress'],
      allowedLabels: [],
      consumedLabels: ['conduit-review'],
    });
    expect(out).toContain('Remove the label that gated this run');
    expect(out).toContain('"conduit-review"');
    // The no-other-labels guard still fires off the removal directive alone,
    // and phrases itself as remove-only (no phantom "apply" list).
    expect(out).toContain('Leave every other label untouched');
    expect(out).toContain("only remove what's listed above");
    expect(out).not.toContain('only apply and remove');
  });

  it('switches to pull-request wording driven through the GitHub MCP when isPr', () => {
    const out = issueWritebackPrompt({
      platform: 'github',
      owner: 'acme',
      repo: 'web',
      issueNumber: '7',
      allowedStatuses: [],
      allowedLabels: ['needs-changes'],
      allowedPrStates: ['open', 'closed'],
      isPr: true,
    });
    expect(out).toContain('update the GitHub pull request this run was triggered by');
    expect(out).toContain('PR: acme/web#7');
    // Drives writeback through the attached GitHub MCP server, not the
    // unauthenticated gh CLI baked into the runner.
    expect(out).toContain('GitHub MCP tools');
    expect(out).not.toContain('gh pr');
    expect(out).not.toContain('gh CLI');
    // PR labels live on the shared issue number — the agent is pointed at the
    // issue-label tools rather than a PR-only one.
    expect(out).toContain('PR labels on the same number as issues');
    // Open/closed directive is the repo-native state axis — no board needed.
    expect(out).toContain("Set the pull request's open/closed state");
    expect(out).toContain('"open"');
    expect(out).toContain('"closed"');
    // Labels still apply (GitHub treats PRs as issues for labels).
    expect(out).toContain('"needs-changes"');
    // Never the issue-shaped anchor.
    expect(out).not.toContain('Issue: acme/web#7');
  });

  it('omits the PR-state directive on a non-PR run even if states are passed', () => {
    const out = issueWritebackPrompt({
      platform: 'github',
      owner: 'acme',
      repo: 'web',
      issueNumber: '7',
      allowedStatuses: [],
      allowedLabels: ['bug'],
      allowedPrStates: ['closed'],
      isPr: false,
    });
    expect(out).toContain('Issue: acme/web#7');
    expect(out).not.toContain('open/closed state');
    expect(out).not.toContain('`gh pr');
  });

  it('skips the PR-state directive when no states are allowed (labels-only PR run)', () => {
    const out = issueWritebackPrompt({
      platform: 'github',
      owner: 'acme',
      repo: 'web',
      issueNumber: '7',
      allowedStatuses: [],
      allowedLabels: ['needs-changes'],
      allowedPrStates: [],
      isPr: true,
    });
    // PR wording, but no state line because nothing was allowed.
    expect(out).toContain('PR: acme/web#7');
    expect(out).not.toContain('open/closed state');
    expect(out).toContain('"needs-changes"');
  });
});

describe('issueWritebackPrompt — GitLab (labels-only)', () => {
  it('addresses a GitLab issue and points at the attached MCP server, not a CLI', () => {
    const out = issueWritebackPrompt({
      platform: 'gitlab',
      owner: 'acme',
      repo: 'shop',
      issueNumber: '42',
      allowedStatuses: ['AIDev'], // inert for GitLab — no boards
      allowedLabels: ['conduit-review'],
      consumedLabels: ['conduit-dev'],
    });
    expect(out).toContain('update the GitLab issue this run was triggered by');
    expect(out).toContain('Issue: acme/shop#42');
    expect(out).toContain('GitLab (writeback)');
    expect(out).toContain('MCP tools');
    // Labels-only: the inert status is dropped and no CLI is referenced.
    expect(out).not.toContain('project Status');
    expect(out).not.toContain('"AIDev"');
    expect(out).not.toContain('gh ');
    expect(out).not.toContain('glab');
    // Label handoff still works.
    expect(out).toContain('"conduit-review"');
    expect(out).toContain('Remove the label that gated this run');
    expect(out).toContain('"conduit-dev"');
  });

  it('is repo-scoped for a GitLab run with no triggering issue', () => {
    const out = issueWritebackPrompt({
      platform: 'gitlab',
      owner: 'acme',
      repo: 'shop',
      allowedStatuses: [],
      allowedLabels: ['triage'],
    });
    expect(out).not.toContain('Issue: acme/shop#');
    expect(out).toContain('every GitLab issue you created or updated in acme/shop');
    expect(out).toContain('"triage"');
  });

  it('stays issue-shaped (no PR wording) for a GitLab MR-triggered run', () => {
    // MR-state / MR-label writeback is out of scope: isPr must not flip GitLab
    // to pull-request wording or the gh pr CLI.
    const out = issueWritebackPrompt({
      platform: 'gitlab',
      owner: 'acme',
      repo: 'shop',
      allowedStatuses: [],
      allowedLabels: ['needs-changes'],
      allowedPrStates: ['closed'],
      isPr: true,
    });
    expect(out).not.toContain('pull request');
    expect(out).not.toContain('PR: acme/shop#');
    expect(out).not.toContain('open/closed state');
    expect(out).not.toContain('gh pr');
    expect(out).toContain('"needs-changes"');
  });
});
