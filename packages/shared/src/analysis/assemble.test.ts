import { describe, expect, it } from 'vitest';
import { templateFileSchema } from '../template/schema';
import { workflowDefinitionSchema } from '../workflow/definition';
import { ANALYSIS_REPO_PLACEHOLDER } from './adapter';
import { assembleSuggestionBundle, type AssembleContext } from './assemble';
import type { WorkflowDraft } from './workflow-draft';

const presets = {
  scope: { provider: 'claude' as const, model: 'claude-sonnet-4-6', instructions: 'scope base' },
  codeAnalyst: { provider: 'codex' as const, model: 'gpt-5.5', instructions: 'analyst base' },
  issuePublisher: {
    provider: 'claude' as const,
    model: 'claude-sonnet-4-6',
    instructions: 'publisher base',
  },
};

const ctx: AssembleContext = {
  repo: { owner: 'acme', name: 'api' },
  platform: 'github',
  defaultBranch: 'main',
  presets,
};

const SECURITY_PROSE = 'Hunt for auth bypasses and injection in the API surface.';
const QUALITY_PROSE = 'Check for missing error handling and unsafe casts.';
const SCOPE_PROSE = 'Route changed API files to the right reviewer section.';

function draft(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    component: 'API',
    workflowName: 'Review: API',
    summary: 'Reviews the API surface',
    rationale: 'High churn, high criticality',
    scopeInstructions: SCOPE_PROSE,
    reviewers: [
      { name: 'Security', instructions: SECURITY_PROSE },
      { name: 'Quality', instructions: QUALITY_PROSE },
    ],
    cron: '0 2 * * *',
    paths: ['apps/api/**'],
    ...overrides,
  };
}

describe('assembleSuggestionBundle', () => {
  it('builds a validated bundle with Scope + reviewers + Publisher per component', () => {
    const { bundle, dropped } = assembleSuggestionBundle([draft()], ctx);
    expect(dropped).toEqual([]);
    expect(bundle).not.toBeNull();
    expect(bundle!.workflows).toHaveLength(1);

    const def = bundle!.workflows[0]!.definition;
    const nodeNames = def.nodes.map((n) => n.name);
    expect(nodeNames).toEqual(['Scope', 'Security', 'Quality', 'Publisher']);

    // Scope is scoped to the component paths + a cadence-derived window.
    const scope = def.nodes.find((n) => n.name === 'Scope')!;
    expect(scope.instructions).toContain('apps/api/**');
    expect(scope.instructions).toContain('the last 24 hours');

    // Publisher is label-gated only (no board statuses).
    const publisher = def.nodes.find((n) => n.name === 'Publisher')!;
    expect(publisher.issueWriteback?.allowedStatuses).toEqual([]);
    expect(publisher.issueWriteback?.allowedLabels).toContain('conduit-dev');

    // The whole bundle round-trips through the runtime schemas.
    expect(() => templateFileSchema.parse(bundle)).not.toThrow();
    expect(() => workflowDefinitionSchema.parse(def)).not.toThrow();
  });

  it('uses preset provider/model but authored prose for Scope and reviewers', () => {
    const { bundle } = assembleSuggestionBundle([draft()], ctx);
    const def = bundle!.workflows[0]!.definition;

    const scope = def.nodes.find((n) => n.name === 'Scope')!;
    expect(scope.provider).toBe('claude');
    expect(scope.model).toBe('claude-sonnet-4-6');
    // Authored prose leads; base preset prose is NOT used as a foundation.
    expect(scope.instructions.startsWith(SCOPE_PROSE)).toBe(true);
    expect(scope.instructions).not.toContain('scope base');
    // Scope glue derives the `## <ReviewerName>` headings from the draft.
    expect(scope.instructions).toContain('- `## Security`');
    expect(scope.instructions).toContain('- `## Quality`');
    expect(scope.instructions).toContain('NO_CHANGES');

    const security = def.nodes.find((n) => n.name === 'Security')!;
    expect(security.provider).toBe('codex');
    expect(security.model).toBe('gpt-5.5');
    expect(security.instructions.startsWith(SECURITY_PROSE)).toBe(true);
    expect(security.instructions).not.toContain('analyst base');
    // Reviewer glue wires the ScopeManifest read + findings file + severity format.
    expect(security.instructions).toContain('## Security` section of `.conduit/ScopeManifest.md`');
    expect(security.instructions).toContain('`.conduit/Security.md`');
    expect(security.instructions).toContain('Severity: critical | high | medium | low');

    const quality = def.nodes.find((n) => n.name === 'Quality')!;
    expect(quality.instructions.startsWith(QUALITY_PROSE)).toBe(true);
    expect(quality.instructions).toContain('`.conduit/Quality.md`');
  });

  it('gives each reviewer a unique, safe node id derived from its name', () => {
    const { bundle } = assembleSuggestionBundle(
      [draft({ reviewers: [{ name: 'Api_Contract', instructions: 'x' }] })],
      ctx,
    );
    const ids = bundle!.workflows[0]!.definition.nodes.map((n) => n.id);
    expect(ids).toContain('agent-api-contract');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wires edges Trigger → Scope → each reviewer → Publisher', () => {
    const { bundle } = assembleSuggestionBundle(
      [draft({ reviewers: [{ name: 'Security', instructions: SECURITY_PROSE }] })],
      ctx,
    );
    const def = bundle!.workflows[0]!.definition;
    expect(def.edges).toEqual([
      { from: 'Trigger', to: 'Scope' },
      { from: 'Scope', to: 'Security' },
      { from: 'Security', to: 'Publisher' },
    ]);
  });

  it('carries the repo placeholder on the trigger + MCP server (import-ready)', () => {
    const { bundle } = assembleSuggestionBundle([draft()], ctx);
    const def = bundle!.workflows[0]!.definition;
    const trigger = def.triggers[0]!;
    expect(trigger.connectionId).toBe(ANALYSIS_REPO_PLACEHOLDER);
    expect(trigger.type).toBe('cron');
    if (trigger.type === 'cron') {
      expect(trigger.branch).toBe('main');
      expect(trigger.cron).toBe('0 2 * * *');
    }
    expect(def.mcpServers[0]!.connectionId).toBe(ANALYSIS_REPO_PLACEHOLDER);
    expect(def.mcpServers[0]!.presetId).toBe('github');
  });

  it('drops a component whose reviewer names all sanitize to nothing, surfacing it', () => {
    const { bundle, dropped } = assembleSuggestionBundle(
      [draft({ reviewers: [{ name: '___', instructions: 'x' }] })],
      ctx,
    );
    expect(bundle).toBeNull();
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.component).toBe('API');
  });

  it('dedups reviewers that collide to the same slug, keeping the first', () => {
    // Distinct, schema-valid names that both slugify to `api-contract`.
    const { bundle, dropped } = assembleSuggestionBundle(
      [
        draft({
          reviewers: [
            { name: 'Api_Contract', instructions: 'first' },
            { name: 'Api__Contract', instructions: 'second' },
          ],
        }),
      ],
      ctx,
    );
    expect(dropped).toEqual([]);
    const reviewerNodes = bundle!.workflows[0]!.definition.nodes.filter(
      (n) => n.name !== 'Scope' && n.name !== 'Publisher',
    );
    expect(reviewerNodes).toHaveLength(1);
    expect(reviewerNodes[0]!.name).toBe('Api_Contract');
    expect(reviewerNodes[0]!.instructions.startsWith('first')).toBe(true);
  });

  it('derives a weekly window for a weekly cron', () => {
    const { bundle } = assembleSuggestionBundle([draft({ cron: '0 2 * * 1' })], ctx);
    const scope = bundle!.workflows[0]!.definition.nodes.find((n) => n.name === 'Scope')!;
    expect(scope.instructions).toContain('the last 7 days');
  });

  it('stitches multiple components into one multi-workflow bundle', () => {
    const { bundle } = assembleSuggestionBundle(
      [
        draft({ component: 'API', workflowName: 'Review: API' }),
        draft({ component: 'Web', workflowName: 'Review: Web', paths: ['apps/web/**'] }),
      ],
      ctx,
    );
    expect(bundle!.workflows.map((w) => w.name)).toEqual(['Review: API', 'Review: Web']);
    // Both still validate against the runtime template schema.
    expect(() => templateFileSchema.parse(bundle)).not.toThrow();
  });
});
