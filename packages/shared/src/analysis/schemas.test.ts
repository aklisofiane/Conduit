import { describe, expect, it } from 'vitest';
import { componentManifestSchema } from './component-manifest';
import { workflowDraftSchema } from './workflow-draft';
import { findReviewerDomain, REVIEWER_DOMAINS } from './reviewer-domains';

describe('componentManifestSchema', () => {
  it('accepts a well-formed manifest', () => {
    const result = componentManifestSchema.safeParse({
      components: [
        { name: 'API', paths: ['apps/api/**'], rationale: 'service', criticality: 'high', churn: 12 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a manifest with no components', () => {
    expect(componentManifestSchema.safeParse({ components: [] }).success).toBe(false);
  });

  it('rejects a component with no paths or a bad criticality', () => {
    expect(
      componentManifestSchema.safeParse({
        components: [{ name: 'API', paths: [], rationale: 'x', criticality: 'high' }],
      }).success,
    ).toBe(false);
    expect(
      componentManifestSchema.safeParse({
        components: [{ name: 'API', paths: ['a'], rationale: 'x', criticality: 'urgent' }],
      }).success,
    ).toBe(false);
  });
});

describe('workflowDraftSchema', () => {
  const valid = {
    component: 'API',
    workflowName: 'Review: API',
    summary: 'what',
    rationale: 'why',
    domains: ['security'],
    cron: '0 2 * * *',
    paths: ['apps/api/**'],
  };

  it('accepts a well-formed draft', () => {
    expect(workflowDraftSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty domain list', () => {
    expect(workflowDraftSchema.safeParse({ ...valid, domains: [] }).success).toBe(false);
  });

  it('rejects a malformed cron', () => {
    expect(workflowDraftSchema.safeParse({ ...valid, cron: 'not-a-cron' }).success).toBe(false);
  });
});

describe('REVIEWER_DOMAINS catalog', () => {
  it('every domain maps to the code-analyst preset and has unique keys', () => {
    const keys = REVIEWER_DOMAINS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of REVIEWER_DOMAINS) {
      expect(d.presetId).toBe('code-analyst');
      expect(d.instructionsAppend.length).toBeGreaterThan(0);
    }
  });

  it('findReviewerDomain resolves known keys and rejects unknown', () => {
    expect(findReviewerDomain('security')?.name).toBe('Security');
    expect(findReviewerDomain('nope')).toBeUndefined();
  });
});
