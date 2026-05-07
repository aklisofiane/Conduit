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
    super(
      `Template "${templateId}" agent "${nodeName}" references unknown preset "${presetId}"`,
    );
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
    mcpServers: wf.definition.mcpServers.map((s) =>
      expandMcpServer(s, resolvers.mcp, templateId),
    ),
    ui: wf.definition.ui,
    nodes: wf.definition.nodes.map((n) =>
      expandAgent(n, resolvers.agent, templateId),
    ),
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
  };
}

function expandAgent(
  agent: TemplateAgentInput,
  resolvePreset: PresetResolver,
  templateId: string,
): AgentConfig {
  if (!agent.presetId) {
    return {
      id: agent.id,
      name: agent.name,
      provider: agent.provider!,
      model: agent.model!,
      instructions: agent.instructions!,
      mcpServers: agent.mcpServers,
      skills: agent.skills,
      webSearch: agent.webSearch,
      workspace: agent.workspace,
      constraints: agent.constraints,
    };
  }

  const preset = resolvePreset(agent.presetId);
  if (!preset) {
    throw new UnknownPresetError(agent.presetId, templateId, agent.name);
  }

  const instructions = agent.instructionsAppend
    ? `${preset.instructions}\n\n${agent.instructionsAppend}`
    : preset.instructions;

  return {
    id: agent.id,
    name: agent.name,
    provider: preset.provider,
    model: preset.model,
    instructions,
    mcpServers: agent.mcpServers,
    skills: agent.skills,
    webSearch: agent.webSearch,
    workspace: agent.workspace,
    constraints: agent.constraints,
  };
}
