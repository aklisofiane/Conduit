import { describe, expect, it } from 'vitest';
import { MAX_COMPONENTS, componentManifestSchema } from './component-manifest';
import { workflowDraftSchema } from './workflow-draft';

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

  it('accepts a manifest at the max-components cap', () => {
    const components = Array.from({ length: MAX_COMPONENTS }, (_, i) => ({
      name: `Component${i}`,
      paths: [`apps/component${i}/**`],
      rationale: 'r',
      criticality: 'medium' as const,
    }));
    expect(componentManifestSchema.safeParse({ components }).success).toBe(true);
  });

  it('rejects a manifest exceeding the max-components cap', () => {
    const components = Array.from({ length: MAX_COMPONENTS + 1 }, (_, i) => ({
      name: `Component${i}`,
      paths: [`apps/component${i}/**`],
      rationale: 'r',
      criticality: 'medium' as const,
    }));
    expect(componentManifestSchema.safeParse({ components }).success).toBe(false);
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
    scopeInstructions: 'Inspect the API surface and route changes to reviewers.',
    reviewers: [
      { name: 'Security', instructions: 'Look for auth bypasses in the API.' },
      { name: 'Quality', instructions: 'Look for missing error handling.' },
    ],
    cron: '0 2 * * *',
    paths: ['apps/api/**'],
  };

  it('accepts a well-formed draft', () => {
    expect(workflowDraftSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty scope prompt', () => {
    expect(workflowDraftSchema.safeParse({ ...valid, scopeInstructions: '' }).success).toBe(false);
  });

  it('rejects an empty reviewer list', () => {
    expect(workflowDraftSchema.safeParse({ ...valid, reviewers: [] }).success).toBe(false);
  });

  it('rejects a reviewer with empty instructions or a blank name', () => {
    expect(
      workflowDraftSchema.safeParse({
        ...valid,
        reviewers: [{ name: 'Security', instructions: '' }],
      }).success,
    ).toBe(false);
    expect(
      workflowDraftSchema.safeParse({
        ...valid,
        reviewers: [{ name: '', instructions: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a reviewer name with unsafe characters (matches node-name pattern)', () => {
    for (const name of ['../etc/passwd', 'Sec/urity', 'Api Contract', 'Api-Contract', '2fast']) {
      expect(
        workflowDraftSchema.safeParse({ ...valid, reviewers: [{ name, instructions: 'x' }] })
          .success,
      ).toBe(false);
    }
  });

  it('accepts identifier-style names (letters, digits, underscores; no leading digit)', () => {
    expect(
      workflowDraftSchema.safeParse({
        ...valid,
        reviewers: [{ name: 'ApiContract_v2', instructions: 'x' }],
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate reviewer names within a draft', () => {
    expect(
      workflowDraftSchema.safeParse({
        ...valid,
        reviewers: [
          { name: 'Security', instructions: 'a' },
          { name: 'Security', instructions: 'b' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed cron', () => {
    expect(workflowDraftSchema.safeParse({ ...valid, cron: 'not-a-cron' }).success).toBe(false);
  });
});
