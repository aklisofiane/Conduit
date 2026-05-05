import { describe, expect, it } from 'vitest';
import type { AgentPreset } from '../agent-preset/index';
import {
  collectTemplatePlaceholders,
  expandTemplate,
  isPlaceholder,
  placeholderAlias,
  resolveTemplate,
  templateFileSchema,
  templateInputFileSchema,
  UnknownPresetError,
  type TemplateFile,
  type TemplateInputFile,
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
        triggers: [
          {
            id: 'trigger-1',
            name: 'Trigger1',
            platform: 'github',
            connectionId: '<github>',
            mode: { kind: 'webhook', event: 'issues.opened' },
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
    expect(resolved.definition.triggers[0]!.connectionId).toBe('conn_123');
    expect(resolved.definition.mcpServers[0]!.connectionId).toBe('conn_123');
    const ws = resolved.definition.nodes[0]!.workspace;
    expect(ws.kind === 'repo-clone' && ws.connectionId).toBe('conn_123');
    // Input untouched.
    expect(TEMPLATE.workflows[0]!.definition.triggers[0]!.connectionId).toBe('<github>');
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

const RESEARCH_PRESET: AgentPreset = {
  id: 'research',
  name: 'Research',
  description: 'Reads a ticket and writes a plan.',
  category: 'research',
  provider: 'claude',
  model: 'claude-opus-4-6',
  instructions: 'You are a Research agent. Read the trigger context.',
};
const PRESET_MAP = new Map<string, AgentPreset>([
  [RESEARCH_PRESET.id, RESEARCH_PRESET],
]);

const PRESET_TEMPLATE: TemplateInputFile = {
  id: 'demo-presets',
  name: 'Demo (presets)',
  description: 'demo template using presetId',
  category: 'triage',
  workflows: [
    {
      name: 'A',
      definition: {
        triggers: [
          {
            id: 'trigger-1',
            name: 'Trigger1',
            platform: 'github',
            connectionId: '<github>',
            mode: { kind: 'webhook', event: 'issues.opened' },
            filters: [],
          },
        ],
        nodes: [
          {
            id: 'agent-research',
            name: 'Research',
            presetId: 'research',
            mcpServers: [],
            skills: [],
            workspace: { kind: 'repo-clone', connectionId: '<github>' },
          },
        ],
        edges: [],
        mcpServers: [],
        ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
      },
    },
  ],
};

describe('templateInputFileSchema + expandTemplate', () => {
  it('parses a presetId-only template input', () => {
    expect(templateInputFileSchema.safeParse(PRESET_TEMPLATE).success).toBe(true);
  });

  it('rejects an agent missing both presetId and concrete fields', () => {
    const bad = structuredClone(PRESET_TEMPLATE);
    delete bad.workflows[0]!.definition.nodes[0]!.presetId;
    const result = templateInputFileSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects instructionsAppend without presetId', () => {
    const bad = structuredClone(PRESET_TEMPLATE);
    const node = bad.workflows[0]!.definition.nodes[0]!;
    delete node.presetId;
    node.provider = 'claude';
    node.model = 'claude-opus-4-6';
    node.instructions = 'literal';
    node.instructionsAppend = 'oops';
    const result = templateInputFileSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('expandTemplate fills instructions/model/provider from the preset', () => {
    const expanded = expandTemplate(PRESET_TEMPLATE, PRESET_MAP);
    const node = expanded.workflows[0]!.definition.nodes[0]!;
    expect(node.instructions).toBe(RESEARCH_PRESET.instructions);
    expect(node.model).toBe(RESEARCH_PRESET.model);
    expect(node.provider).toBe(RESEARCH_PRESET.provider);
    // Resulting shape passes the strict runtime schema.
    expect(templateFileSchema.safeParse(expanded).success).toBe(true);
  });

  it('expandTemplate concatenates instructionsAppend after the preset prompt', () => {
    const t = structuredClone(PRESET_TEMPLATE);
    t.workflows[0]!.definition.nodes[0]!.instructionsAppend = 'Extra workflow guidance.';
    const expanded = expandTemplate(t, PRESET_MAP);
    const out = expanded.workflows[0]!.definition.nodes[0]!.instructions;
    expect(out.startsWith(RESEARCH_PRESET.instructions)).toBe(true);
    expect(out.endsWith('Extra workflow guidance.')).toBe(true);
    expect(out).toContain('\n\n');
  });

  it('expandTemplate throws UnknownPresetError when the preset is missing', () => {
    expect(() => expandTemplate(PRESET_TEMPLATE, new Map())).toThrow(
      UnknownPresetError,
    );
  });
});
