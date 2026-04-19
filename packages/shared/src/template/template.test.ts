import { describe, expect, it } from 'vitest';
import {
  collectTemplatePlaceholders,
  isPlaceholder,
  placeholderAlias,
  resolveTemplate,
  templateFileSchema,
  type TemplateFile,
} from './index';

const TEMPLATE: TemplateFile = {
  id: 'demo',
  name: 'Demo',
  description: 'demo template',
  category: 'triage',
  workflows: [
    {
      name: 'A',
      definition: {
        trigger: {
          platform: 'github',
          connectionId: '<github>',
          mode: { kind: 'webhook', event: 'issues.opened', active: true },
          filters: [],
        },
        nodes: [
          {
            id: 'agent-a',
            name: 'A',
            provider: 'claude',
            model: 'stub',
            instructions: 'do something',
            mcpServers: [],
            skills: [],
            workspace: { kind: 'repo-clone', connectionId: '<github>' },
          },
        ],
        edges: [],
        mcpServers: [
          {
            id: 'gh',
            name: 'GitHub',
            transport: {
              kind: 'stdio',
              command: 'noop',
              args: [],
              env: {},
            },
            connectionId: '<github>',
          },
        ],
        ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
      },
    },
  ],
};

describe('template placeholders', () => {
  it('identifies placeholder strings', () => {
    expect(isPlaceholder('<github>')).toBe(true);
    expect(isPlaceholder('<slack-prod>')).toBe(true);
    expect(isPlaceholder('github')).toBe(false);
    expect(isPlaceholder('<>')).toBe(false);
    expect(placeholderAlias('<github>')).toBe('github');
  });

  it('collects unique placeholders across all connection slots', () => {
    expect(collectTemplatePlaceholders(TEMPLATE)).toEqual(['github']);
  });
});

describe('resolveTemplate', () => {
  it('substitutes placeholders with real connection ids without mutating input', () => {
    const resolved = resolveTemplate(TEMPLATE, { github: 'conn_123' })[0]!;
    expect(resolved.definition.trigger.connectionId).toBe('conn_123');
    expect(resolved.definition.mcpServers[0]!.connectionId).toBe('conn_123');
    const ws = resolved.definition.nodes[0]!.workspace;
    expect(ws.kind === 'repo-clone' && ws.connectionId).toBe('conn_123');
    // Input untouched.
    expect(TEMPLATE.workflows[0]!.definition.trigger.connectionId).toBe('<github>');
  });

  it('throws when a placeholder has no binding', () => {
    expect(() => resolveTemplate(TEMPLATE, {})).toThrow(/<github>/);
  });
});

describe('templateFileSchema', () => {
  it('accepts placeholder strings (structural only)', () => {
    expect(templateFileSchema.safeParse(TEMPLATE).success).toBe(true);
  });

  it('rejects a bad category', () => {
    const result = templateFileSchema.safeParse({ ...TEMPLATE, category: 'not-real' });
    expect(result.success).toBe(false);
  });
});
