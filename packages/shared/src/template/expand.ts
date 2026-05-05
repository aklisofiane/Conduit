import type { AgentPreset } from '../agent-preset/index';
import type { AgentConfig } from '../agent/index';
import type { WorkflowDefinition } from '../workflow/definition';
import type {
  TemplateAgentInput,
  TemplateInputFile,
  TemplateInputWorkflow,
} from './schema';
import type { TemplateFile, TemplateWorkflow } from './schema';

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
 * Expand `presetId` references on every agent in a template input file,
 * producing the post-expansion `TemplateFile` shape that the rest of the
 * system already understands. Throws `UnknownPresetError` if any agent
 * references a preset that's not in `presetMap` — caller decides whether
 * to log + skip or surface the error.
 */
export function expandTemplate(
  input: TemplateInputFile,
  presetMap: ReadonlyMap<string, AgentPreset>,
): TemplateFile {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    category: input.category,
    workflows: input.workflows.map((wf) =>
      expandWorkflow(wf, presetMap, input.id),
    ),
  };
}

function expandWorkflow(
  wf: TemplateInputWorkflow,
  presetMap: ReadonlyMap<string, AgentPreset>,
  templateId: string,
): TemplateWorkflow {
  const definition: WorkflowDefinition = {
    triggers: wf.definition.triggers,
    edges: wf.definition.edges,
    mcpServers: wf.definition.mcpServers,
    ui: wf.definition.ui,
    nodes: wf.definition.nodes.map((n) =>
      expandAgent(n, presetMap, templateId),
    ),
  };
  return { name: wf.name, description: wf.description, definition };
}

function expandAgent(
  agent: TemplateAgentInput,
  presetMap: ReadonlyMap<string, AgentPreset>,
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
      workspace: agent.workspace,
      constraints: agent.constraints,
    };
  }

  const preset = presetMap.get(agent.presetId);
  if (!preset) {
    throw new UnknownPresetError(agent.presetId, templateId, agent.name);
  }

  const baseInstructions = preset.instructions;
  const instructions = agent.instructionsAppend
    ? `${baseInstructions}\n\n${agent.instructionsAppend}`
    : baseInstructions;

  return {
    id: agent.id,
    name: agent.name,
    provider: preset.provider,
    model: preset.model,
    instructions,
    mcpServers: agent.mcpServers,
    skills: agent.skills,
    workspace: agent.workspace,
    constraints: agent.constraints,
  };
}
