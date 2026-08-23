import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '../workflow/definition';
import { resolveTemplate, slugifyTemplateId, summarizeTemplate, workflowToTemplate } from './index';

function liveDefinition(): WorkflowDefinition {
  return {
    triggers: [
      {
        id: 'trigger-1',
        name: 'Trigger1',
        platform: 'github',
        connectionId: 'conn_repo',
        boardConnectionId: 'conn_board',
        type: 'issues',
        intervalSec: 60,
        filters: [],
      },
    ],
    nodes: [
      {
        id: 'agent-a',
        name: 'A',
        provider: 'claude',
        model: 'stub',
        instructions: 'do something',
        mcpServers: [],
        skills: [],
        webSearch: false,
      },
    ],
    edges: [],
    mcpServers: [
      {
        id: 'gh',
        name: 'GitHub',
        transport: { kind: 'stdio', command: 'noop', args: [], env: {} },
        connectionId: 'conn_repo',
      },
    ],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

describe('workflowToTemplate', () => {
  it('replaces every connection id with the resolver-supplied placeholder', () => {
    const aliases: Record<string, string> = {
      conn_repo: 'repo',
      conn_board: 'board',
    };
    const file = workflowToTemplate(
      { name: 'My Flow', definition: liveDefinition() },
      { aliasFor: (id) => aliases[id]! },
    );

    expect(file.category).toBe('custom');
    expect(file.id).toBe('my-flow');
    const def = file.workflows[0]!.definition;
    expect(def.triggers[0]!.connectionId).toBe('<repo>');
    expect(def.triggers[0]!.boardConnectionId).toBe('<board>');
    expect(def.mcpServers[0]!.connectionId).toBe('<repo>');
  });

  it('does not mutate the input definition', () => {
    const def = liveDefinition();
    workflowToTemplate({ name: 'Flow', definition: def }, { aliasFor: () => 'x' });
    expect(def.triggers[0]!.connectionId).toBe('conn_repo');
  });

  it('round-trips: resolve(export(def)) reproduces the original ids', () => {
    const original = liveDefinition();
    const aliases: Record<string, string> = {
      conn_repo: 'repo',
      conn_board: 'board',
    };
    const file = workflowToTemplate(
      { name: 'Flow', definition: original },
      { aliasFor: (id) => aliases[id]! },
    );
    const resolved = resolveTemplate(file, { repo: 'conn_repo', board: 'conn_board' })[0]!;
    expect(resolved.definition).toEqual(original);
  });

  it('produces no placeholders for a connection-less (trigger-less) workflow', () => {
    const def = liveDefinition();
    def.triggers = [];
    def.mcpServers = [];
    const file = workflowToTemplate(
      { name: 'Bare Flow', definition: def },
      { aliasFor: () => 'unused' },
    );
    expect(summarizeTemplate(file).placeholders).toEqual([]);
    // Resolves with no bindings.
    expect(() => resolveTemplate(file, {})).not.toThrow();
  });
});

describe('slugifyTemplateId', () => {
  it('kebab-cases names', () => {
    expect(slugifyTemplateId('Nightly Review!')).toBe('nightly-review');
    expect(slugifyTemplateId('  PR   Triage  ')).toBe('pr-triage');
  });

  it('strips leading non-letters and falls back when empty', () => {
    expect(slugifyTemplateId('123 Flow')).toBe('flow');
    expect(slugifyTemplateId('---')).toBe('exported-workflow');
    expect(slugifyTemplateId('🚀')).toBe('exported-workflow');
  });
});

describe('summarizeTemplate', () => {
  it('derives placeholders + boardAliases from the file', () => {
    const file = workflowToTemplate(
      { name: 'Flow', definition: liveDefinition() },
      { aliasFor: (id) => (id === 'conn_board' ? 'board' : 'repo') },
    );
    const summary = summarizeTemplate(file);
    expect(summary.category).toBe('custom');
    expect(summary.workflowCount).toBe(1);
    expect(summary.placeholders.sort()).toEqual(['board', 'repo']);
    expect(summary.boardAliases).toEqual(['board']);
  });
});
