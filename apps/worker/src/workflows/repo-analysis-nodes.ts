import type { AgentConfigWithWorkspace, Component } from '@conduit/shared';
import {
  ANALYSIS_DISCOVER_NODE,
  ANALYSIS_DRAFT_PATH,
  ANALYSIS_MANIFEST_PATH,
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

**Inspect the component's code** under those paths first. You already have the worktree — read it. Understand what kind of thing this component is (an HTTP/WS API, a web frontend, a shared library, a CLI, a worker/service, an infra package…) and what failure modes actually matter for *it*. The whole point is that the review you design fits this component specifically, not a generic preset.

**Consult the bundled skills.** Three skills have been staged into your workspace's \`.claude/skills\` — read them before authoring:
- **\`draft-format\`** — the exact \`WorkflowDraft\` JSON shape you must write, field-by-field, with the reviewer-name charset rule and a worked example.
- **\`scope-authoring\`** — how to write a strong, component-tailored Scope prompt and how the ScopeManifest routes change sets to reviewers.
- **\`reviewer-authoring\`** — how to author component-specific reviewers, including a menu of example review lenses to draw from, adapt, or extend.

You **author** the review's prose — you do not select from a fixed catalog. The skills own the full JSON schema and the lens menu; follow them rather than guessing.

Then **author** the following into the draft:

1. **\`scopeInstructions\`** — a component-tailored Scope prompt body (per the \`scope-authoring\` skill). Write the routing *judgment* for this component; the code appends the mechanical glue (path-scoping, diff window, \`## <ReviewerName>\` headings, \`NO_CHANGES\` rule).
2. **\`reviewers\`** — an array of at least one \`{ name, instructions }\` (per the \`reviewer-authoring\` skill). Each \`name\` must match \`/^[A-Za-z_][A-Za-z0-9_]*$/\` — PascalCase or snake_case, letters/digits/underscores only, no leading digit, no spaces or hyphens (a bad name fails validation). Each \`instructions\` says *what to look for* in this component; the code appends the manifest-read and findings-output contract.
3. **\`cron\`** — a 5-field POSIX cron cadence weighted by churn × criticality. Busier / more critical components warrant a tighter cadence (e.g. nightly); quiet or low-criticality ones a weekly or monthly cadence.
4. **\`paths\`** — echo this component's paths: ${JSON.stringify(component.paths)}.

Write the draft as a single JSON object to \`${ANALYSIS_DRAFT_PATH}\` (exactly that path) — ONLY valid JSON, no Markdown fences or surrounding prose; it is parsed and strictly validated by orchestration code, and a malformed draft re-runs this whole step. The \`component\` field must echo "${component.name}". See the \`draft-format\` skill for the exact shape. Also write a short human summary to \`.conduit/<your node name>.md\` (prose, separate from the JSON draft).`;
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
