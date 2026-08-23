import type { AgentPreset } from '../agent-preset/index';
import type { AgentConfig } from '../agent/index';
import type { McpPreset } from '../mcp/presets';
import type { WorkflowMcpServer } from '../mcp/server';
import type { WorkflowDefinition } from '../workflow/definition';
import type {
  TemplateAgentInput,
  TemplateInputFile,
  TemplateInputWorkflow,
  TemplateFile,
  TemplateMcpServerInput,
  TemplateWorkflow,
} from './schema';

export type PresetResolver = (id: string) => AgentPreset | undefined;
export type McpPresetResolver = (id: string) => McpPreset | undefined;

export interface TemplateResolvers {
  agent: PresetResolver;
  mcp: McpPresetResolver;
}

export class UnknownPresetError extends Error {
  constructor(
    public readonly presetId: string,
    public readonly templateId: string,
    public readonly nodeName: string,
  ) {
    super(`Template "${templateId}" agent "${nodeName}" references unknown preset "${presetId}"`);
    this.name = 'UnknownPresetError';
  }
}

export class UnknownMcpPresetError extends Error {
  constructor(
    public readonly presetId: string,
    public readonly templateId: string,
    public readonly serverId: string,
  ) {
    super(
      `Template "${templateId}" mcp server "${serverId}" references unknown mcp preset "${presetId}"`,
    );
    this.name = 'UnknownMcpPresetError';
  }
}

/**
 * Expand `presetId` references — both agent presets on nodes and MCP presets
 * on `mcpServers` — into the runtime workflow shape. Throws
 * `UnknownPresetError` / `UnknownMcpPresetError` so callers can choose
 * between log+skip (loader) and surface (test/CLI).
 */
export function expandTemplate(
  input: TemplateInputFile,
  resolvers: TemplateResolvers,
): TemplateFile {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    category: input.category,
    workflows: input.workflows.map((wf) => expandWorkflow(wf, resolvers, input.id)),
  };
}

function expandWorkflow(
  wf: TemplateInputWorkflow,
  resolvers: TemplateResolvers,
  templateId: string,
): TemplateWorkflow {
  const definition: WorkflowDefinition = {
    triggers: wf.definition.triggers,
    edges: wf.definition.edges,
    mcpServers: wf.definition.mcpServers.map((s) => expandMcpServer(s, resolvers.mcp, templateId)),
    ui: wf.definition.ui,
    nodes: wf.definition.nodes.map((n) => expandAgent(n, resolvers.agent, templateId)),
  };
  return { name: wf.name, description: wf.description, definition };
}

function expandMcpServer(
  server: TemplateMcpServerInput,
  resolveMcpPreset: McpPresetResolver,
  templateId: string,
): WorkflowMcpServer {
  if (!server.presetId) {
    // Schema enforces transport + name when presetId is absent.
    return {
      id: server.id,
      name: server.name!,
      transport: server.transport!,
      connectionId: server.connectionId,
      discoveredTools: server.discoveredTools,
    };
  }
  const preset = resolveMcpPreset(server.presetId);
  if (!preset) {
    throw new UnknownMcpPresetError(server.presetId, templateId, server.id);
  }
  return {
    id: server.id,
    name: server.name ?? preset.name,
    transport: server.transport ?? preset.transport,
    connectionId: server.connectionId,
    discoveredTools: server.discoveredTools,
    // Provenance only when the transport is the preset's own — a template
    // that inlines a custom transport opts out of platform-follow swapping.
    presetId: server.transport ? undefined : server.presetId,
  };
}

function expandAgent(
  agent: TemplateAgentInput,
  resolvePreset: PresetResolver,
  templateId: string,
): AgentConfig {
  // Preserve every AgentConfig field by default; strip only the two
  // template-only fields and override the preset-derived ones below. Rebuilding
  // from an explicit field list silently dropped any AgentConfig field added
  // later (this is how `issueWriteback` went missing) — spreading closes that
  // whole class of bug, and the loader's post-expansion `agentConfigSchema`
  // re-parse strips anything stray.
  const { presetId, instructionsAppend, ...base } = agent;

  if (!presetId) {
    // No preset: provider/model/instructions are inlined on the node, and the
    // schema's superRefine guarantees they're present (non-null asserted to
    // satisfy the required AgentConfig type).
    return {
      ...base,
      provider: agent.provider!,
      model: agent.model!,
      instructions: agent.instructions!,
    };
  }

  const preset = resolvePreset(presetId);
  if (!preset) {
    throw new UnknownPresetError(presetId, templateId, agent.name);
  }

  return {
    ...base,
    provider: preset.provider,
    model: preset.model,
    instructions: instructionsAppend
      ? `${preset.instructions}\n\n${instructionsAppend}`
      : preset.instructions,
  };
}
