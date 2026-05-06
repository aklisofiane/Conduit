import type { AgentPreset } from '../agent-preset/index';
import type { AgentConfig } from '../agent/index';
import type { WorkflowDefinition } from '../workflow/definition';
import type {
  TemplateAgentInput,
  TemplateInputFile,
  TemplateInputWorkflow,
  TemplateFile,
  TemplateWorkflow,
} from './schema';

export type PresetResolver = (id: string) => AgentPreset | undefined;

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

/**
 * Expand `presetId` references on every agent in a template input file.
 * Throws `UnknownPresetError` so callers can choose between log+skip
 * (loader) and surface (test/CLI).
 */
export function expandTemplate(
  input: TemplateInputFile,
  resolvePreset: PresetResolver,
): TemplateFile {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    category: input.category,
    workflows: input.workflows.map((wf) =>
      expandWorkflow(wf, resolvePreset, input.id),
    ),
  };
}

function expandWorkflow(
  wf: TemplateInputWorkflow,
  resolvePreset: PresetResolver,
  templateId: string,
): TemplateWorkflow {
  const definition: WorkflowDefinition = {
    triggers: wf.definition.triggers,
    edges: wf.definition.edges,
    mcpServers: wf.definition.mcpServers,
    ui: wf.definition.ui,
    nodes: wf.definition.nodes.map((n) =>
      expandAgent(n, resolvePreset, templateId),
    ),
  };
  return { name: wf.name, description: wf.description, definition };
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
