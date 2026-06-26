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

function draft(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    component: 'API',
    workflowName: 'Review: API',
    summary: 'Reviews the API surface',
    rationale: 'High churn, high criticality',
    domains: ['security', 'quality'],
    cron: '0 2 * * *',
    paths: ['apps/api/**'],
    ...overrides,
  };
}

describe('assembleSuggestionBundle', () => {
  it('builds a validated bundle with Scope + domains + Publisher per component', () => {
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

  it('wires edges Trigger → Scope → each domain → Publisher', () => {
    const { bundle } = assembleSuggestionBundle([draft({ domains: ['security'] })], ctx);
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

  it('drops unknown domain keys but keeps the recognized ones', () => {
    const { bundle, dropped } = assembleSuggestionBundle(
      [draft({ domains: ['security', 'nonsense', 'security'] })],
      ctx,
    );
    expect(dropped).toEqual([]);
    const names = bundle!.workflows[0]!.definition.nodes.map((n) => n.name);
    expect(names).toEqual(['Scope', 'Security', 'Publisher']);
  });

  it('drops a component whose domains are all unknown, surfacing it', () => {
    const { bundle, dropped } = assembleSuggestionBundle([draft({ domains: ['bogus'] })], ctx);
    expect(bundle).toBeNull();
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.component).toBe('API');
  });

  it('derives a weekly window for a weekly cron', () => {
    const { bundle } = assembleSuggestionBundle([draft({ cron: '0 2 * * 1' })], ctx);
    const scope = bundle!.workflows[0]!.definition.nodes.find((n) => n.name === 'Scope')!;
    expect(scope.instructions).toContain('the last 7 days');
  });

  it('stitches multiple components into one multi-workflow bundle', () => {
    const { bundle } = assembleSuggestionBundle(
      [draft({ component: 'API', workflowName: 'Review: API' }), draft({ component: 'Web', workflowName: 'Review: Web', paths: ['apps/web/**'] })],
      ctx,
    );
    expect(bundle!.workflows.map((w) => w.name)).toEqual(['Review: API', 'Review: Web']);
  });
});
