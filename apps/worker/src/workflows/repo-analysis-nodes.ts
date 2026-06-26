import type { AgentConfigWithWorkspace, Component } from '@conduit/shared';
import {
  ANALYSIS_DISCOVER_NODE,
  ANALYSIS_DRAFT_PATH,
  ANALYSIS_MANIFEST_PATH,
  REVIEWER_DOMAINS,
} from '@conduit/shared';

/**
 * Inlined analyzer prompts + node builders. The analyzer agents aren't
 * user-editable on the canvas, so they have no `agent-presets/*.md`; their
 * `AgentConfig`s are forged here in code. Pure module (strings + types only)
 * so it's safe to import from the Temporal V8 workflow sandbox.
 */

/** Both analyzer agents run on Claude — they inspect, they don't write code. */
const ANALYZER_PROVIDER = 'claude' as const;
const ANALYZER_MODEL = 'claude-sonnet-4-6';

const DOMAIN_CATALOG_BLOCK = REVIEWER_DOMAINS.map((d) => `- \`${d.key}\` — ${d.name}`).join('\n');

const DISCOVER_INSTRUCTIONS = `You are the Discover agent for Conduit's repo analyzer. Map this repository into its distinct **components** so each can get its own tailored review workflow.

Read the signals that reveal structure (only those that exist):
- \`CLAUDE.md\`, \`AGENTS.md\`, \`README\` files
- Workspace manifests: root \`package.json\` (\`workspaces\`), \`turbo.json\`, \`pnpm-workspace.yaml\`, \`go.mod\`, \`Cargo.toml\`, \`pyproject.toml\`
- \`CODEOWNERS\`
- \`git log\` for recent churn per area

A **component** is a coherent unit a reviewer reasons about as a whole — an app, a package, a service, or a major subsystem. Prefer a handful of meaningful components over many tiny ones.

Write a JSON file to \`${ANALYSIS_MANIFEST_PATH}\` (exactly that path) with this shape:

\`\`\`json
{
  "components": [
    {
      "name": "API",
      "paths": ["apps/api/**"],
      "rationale": "HTTP + WS service, independently deployable",
      "churn": 42,
      "criticality": "high"
    }
  ]
}
\`\`\`

Rules:
- \`paths\` are repo-relative globs delimiting the component's source.
- \`criticality\` is one of \`low\`, \`medium\`, \`high\`. \`churn\` (recent commit count) is optional.
- Emit at least one component, and write ONLY valid JSON at that path — it is parsed by orchestration code.

Also write a short human summary to \`.conduit/${ANALYSIS_DISCOVER_NODE}.md\` (the runtime owns that file).`;

/** Discover agent — fixed-branch entry of the analysis run. */
export function discoverNode(defaultBranch: string): AgentConfigWithWorkspace {
  return {
    id: 'agent-discover',
    name: ANALYSIS_DISCOVER_NODE,
    provider: ANALYZER_PROVIDER,
    model: ANALYZER_MODEL,
    instructions: DISCOVER_INSTRUCTIONS,
    mcpServers: [],
    skills: [],
    webSearch: false,
    workspace: { kind: 'fixed-branch', branch: defaultBranch },
  };
}

/** Stable, unique node name for the i-th Design agent. */
export function designNodeName(index: number): string {
  return `Design_${index}`;
}

function designInstructions(component: Component): string {
  const paths = component.paths.map((p) => `- ${p}`).join('\n');
  const churn = component.churn === undefined ? 'unknown' : String(component.churn);
  return `You are a Design agent for Conduit's repo analyzer. Design ONE periodic review workflow for a single component of this repository.

Component: **${component.name}**
Paths:
${paths}
Rationale: ${component.rationale}
Criticality: ${component.criticality}
Recent churn: ${churn}

Inspect the component's code under those paths to understand which kinds of review matter for it. Then choose:

1. **Reviewer domains** — select the keys that genuinely apply from this fixed catalog (do not invent keys):
${DOMAIN_CATALOG_BLOCK}

2. **Cadence** — a 5-field POSIX cron expression weighted by churn × criticality. Busier / more critical components warrant a tighter cadence (e.g. nightly); quiet or low-criticality ones a weekly or monthly cadence.

Write a JSON file to \`${ANALYSIS_DRAFT_PATH}\` (exactly that path) with this shape:

\`\`\`json
{
  "component": "${component.name}",
  "workflowName": "Review: ${component.name}",
  "summary": "one line: what this workflow reviews",
  "rationale": "one line: why these domains and this cadence",
  "domains": ["security", "quality"],
  "cron": "0 2 * * *",
  "paths": ${JSON.stringify(component.paths)}
}
\`\`\`

Pick at least one domain key from the catalog above. Emit ONLY valid JSON at that path — it is parsed by orchestration code. Also write a short human summary to \`.conduit/<your node name>.md\`.`;
}

/**
 * Design agent for one component — inherits the Discover workspace as a
 * parallel branched worktree (read-only, no merge-back), so concurrent
 * per-component `.conduit/` writes don't collide.
 */
export function designNode(component: Component, index: number): AgentConfigWithWorkspace {
  return {
    id: `agent-design-${index}`,
    name: designNodeName(index),
    provider: ANALYZER_PROVIDER,
    model: ANALYZER_MODEL,
    instructions: designInstructions(component),
    mcpServers: [],
    skills: [],
    webSearch: false,
    workspace: { kind: 'inherit', fromNode: ANALYSIS_DISCOVER_NODE },
  };
}
