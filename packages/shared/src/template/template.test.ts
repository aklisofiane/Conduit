import { describe, expect, it } from 'vitest';
import type { AgentPreset } from '../agent-preset/index';
import { MCP_PRESETS, findMcpPreset } from '../mcp/presets';
import {
  collectTemplatePlaceholderDetails,
  collectTemplatePlaceholders,
  expandTemplate,
  isPlaceholder,
  placeholderAlias,
  resolveTemplate,
  templateFileSchema,
  templateInputFileSchema,
  UnknownMcpPresetError,
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
            connectionId: '<github-repo>',
            type: 'webhook',
            event: 'issues.opened',
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
            transport: {
              kind: 'stdio',
              command: 'noop',
              args: [],
              env: {},
            },
            connectionId: '<github-repo>',
          },
        ],
        ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
      },
    },
  ],
};

const BOARD_TEMPLATE: TemplateFile = {
  id: 'demo-board',
  name: 'Demo Board',
  description: 'demo template with a board connection',
  category: 'review',
  workflows: [
    {
      name: 'A',
      definition: {
        triggers: [
          {
            id: 'trigger-1',
            name: 'Trigger1',
            platform: 'github',
            connectionId: '<github-repo>',
            boardConnectionId: '<github-board>',
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
        mcpServers: [],
        ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
      },
    },
  ],
};

describe('template placeholders', () => {
  it('identifies placeholder strings', () => {
    expect(isPlaceholder('<github-repo>')).toBe(true);
    expect(isPlaceholder('<slack-prod>')).toBe(true);
    expect(isPlaceholder('github')).toBe(false);
    expect(isPlaceholder('<>')).toBe(false);
    expect(placeholderAlias('<github-repo>')).toBe('github-repo');
  });

  it('collects unique placeholders across all connection slots', () => {
    expect(collectTemplatePlaceholders(TEMPLATE)).toEqual(['github-repo']);
  });

  it('reports per-slot expected scope kinds via collectTemplatePlaceholderDetails', () => {
    const details = collectTemplatePlaceholderDetails(BOARD_TEMPLATE);
    const byAlias = new Map(details.map((d) => [d.alias, d.expectedScopeKinds]));
    expect(byAlias.get('github-repo')).toEqual(['repo']);
    expect(byAlias.get('github-board')).toEqual(['github_projects_v2']);
  });
});

describe('resolveTemplate', () => {
  it('substitutes placeholders with real connection ids without mutating input', () => {
    const resolved = resolveTemplate(TEMPLATE, { 'github-repo': 'conn_123' })[0]!;
    expect(resolved.definition.triggers[0]!.connectionId).toBe('conn_123');
    expect(resolved.definition.mcpServers[0]!.connectionId).toBe('conn_123');
    // Workspaces are derived from edges at runtime; templates carry no
    // workspace fields, so there's nothing to substitute on a node.
    expect(resolved.definition.nodes[0]!.workspace).toBeUndefined();
    // Input untouched.
    expect(TEMPLATE.workflows[0]!.definition.triggers[0]!.connectionId).toBe(
      '<github-repo>',
    );
  });

  it('substitutes both connectionId and boardConnectionId when present', () => {
    const resolved = resolveTemplate(BOARD_TEMPLATE, {
      'github-repo': 'conn_repo',
      'github-board': 'conn_board',
    })[0]!;
    expect(resolved.definition.triggers[0]!.connectionId).toBe('conn_repo');
    expect(resolved.definition.triggers[0]!.boardConnectionId).toBe('conn_board');
  });

  it('clears boardConnectionId when board binding is omitted', () => {
    const resolved = resolveTemplate(BOARD_TEMPLATE, {
      'github-repo': 'conn_repo',
    })[0]!;
    expect(resolved.definition.triggers[0]!.connectionId).toBe('conn_repo');
    expect(resolved.definition.triggers[0]!.boardConnectionId).toBeUndefined();
  });

  it('throws when a placeholder has no binding', () => {
    expect(() => resolveTemplate(TEMPLATE, {})).toThrow(/<github-repo>/);
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
const resolveFromMap = {
  agent: (id: string) => PRESET_MAP.get(id),
  mcp: () => undefined,
};

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
            connectionId: '<github-repo>',
            type: 'webhook',
            event: 'issues.opened',
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
            webSearch: false,
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
    const expanded = expandTemplate(PRESET_TEMPLATE, resolveFromMap);
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
    const expanded = expandTemplate(t, resolveFromMap);
    const out = expanded.workflows[0]!.definition.nodes[0]!.instructions;
    expect(out.startsWith(RESEARCH_PRESET.instructions)).toBe(true);
    expect(out.endsWith('Extra workflow guidance.')).toBe(true);
    expect(out).toContain('\n\n');
  });

  it('expandTemplate throws UnknownPresetError when the preset is missing', () => {
    expect(() =>
      expandTemplate(PRESET_TEMPLATE, { agent: () => undefined, mcp: () => undefined }),
    ).toThrow(UnknownPresetError);
  });
});

describe('mcp preset expansion', () => {
  const githubPreset = findMcpPreset('github')!;
  const baseInput: TemplateInputFile = {
    id: 'demo-mcp-presets',
    name: 'Demo (mcp presets)',
    description: 'demo using mcp presetId',
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
              connectionId: '<github-repo>',
              type: 'webhook',
              event: 'issues.opened',
              filters: [],
            },
          ],
          nodes: [
            {
              id: 'agent-a',
              name: 'A',
              presetId: 'research',
              mcpServers: [{ serverId: 'github-mcp' }],
              skills: [],
              webSearch: false,
            },
          ],
          edges: [],
          mcpServers: [
            { id: 'github-mcp', presetId: 'github', connectionId: '<github-repo>' },
          ],
          ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        },
      },
    ],
  };

  it('parses an mcp server with presetId only (no transport inlined)', () => {
    expect(templateInputFileSchema.safeParse(baseInput).success).toBe(true);
  });

  it('expandTemplate copies transport + name from the mcp preset', () => {
    const expanded = expandTemplate(baseInput, {
      agent: () => RESEARCH_PRESET,
      mcp: findMcpPreset,
    });
    const server = expanded.workflows[0]!.definition.mcpServers[0]!;
    expect(server.name).toBe(githubPreset.name);
    expect(server.transport).toEqual(githubPreset.transport);
    expect(server.connectionId).toBe('<github-repo>');
    // Provenance survives expansion so instantiation can platform-swap.
    expect(server.presetId).toBe('github');
    expect(templateFileSchema.safeParse(expanded).success).toBe(true);
  });

  it('expandTemplate drops presetId provenance when the template inlines a transport', () => {
    const t = structuredClone(baseInput);
    t.workflows[0]!.definition.mcpServers[0]!.transport = {
      kind: 'stdio',
      command: 'custom',
      args: [],
      env: {},
    };
    const expanded = expandTemplate(t, {
      agent: () => RESEARCH_PRESET,
      mcp: findMcpPreset,
    });
    expect(expanded.workflows[0]!.definition.mcpServers[0]!.presetId).toBeUndefined();
  });

  it('preset-backed mcp slots expect a repo-type scope; user transports stay any', () => {
    const expanded = expandTemplate(baseInput, {
      agent: () => RESEARCH_PRESET,
      mcp: findMcpPreset,
    });
    const details = collectTemplatePlaceholderDetails(expanded);
    const repoSlot = details.find((d) => d.alias === 'github-repo')!;
    expect(repoSlot.expectedScopeKinds).toEqual(['repo']);

    const userTransport = structuredClone(baseInput);
    userTransport.workflows[0]!.definition.mcpServers[0]! = {
      id: 'github-mcp',
      name: 'Custom',
      transport: { kind: 'stdio', command: 'custom', args: [], env: {} },
      connectionId: '<custom-server>',
    };
    const expandedUser = expandTemplate(userTransport, {
      agent: () => RESEARCH_PRESET,
      mcp: findMcpPreset,
    });
    const userDetails = collectTemplatePlaceholderDetails(expandedUser);
    expect(
      userDetails.find((d) => d.alias === 'custom-server')!.expectedScopeKinds,
    ).toEqual(['any']);
  });

  it('expandTemplate throws UnknownMcpPresetError when the mcp preset is missing', () => {
    expect(() =>
      expandTemplate(baseInput, {
        agent: () => RESEARCH_PRESET,
        mcp: () => undefined,
      }),
    ).toThrow(UnknownMcpPresetError);
  });

  it('rejects an mcp server missing both presetId and transport', () => {
    const bad = structuredClone(baseInput);
    bad.workflows[0]!.definition.mcpServers[0] = {
      id: 'github-mcp',
      connectionId: '<github-repo>',
    } as (typeof bad)['workflows'][0]['definition']['mcpServers'][0];
    expect(templateInputFileSchema.safeParse(bad).success).toBe(false);
  });

  it('every shipped MCP preset round-trips through expansion', () => {
    for (const p of MCP_PRESETS) {
      const t: TemplateInputFile = {
        ...baseInput,
        workflows: [
          {
            ...baseInput.workflows[0]!,
            definition: {
              ...baseInput.workflows[0]!.definition,
              mcpServers: [{ id: `${p.id}-mcp`, presetId: p.id }],
            },
          },
        ],
      };
      const expanded = expandTemplate(t, {
        agent: () => RESEARCH_PRESET,
        mcp: findMcpPreset,
      });
      expect(templateFileSchema.safeParse(expanded).success).toBe(true);
    }
  });
});
