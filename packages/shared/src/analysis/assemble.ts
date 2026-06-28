import type { Platform, TriggerSource } from '../platform/index';
import { findMcpPresetByPlatform } from '../mcp/index';
import {
  templateFileSchema,
  type TemplateFile,
  type TemplateWorkflow,
} from '../template/schema';
import { ANALYSIS_REPO_PLACEHOLDER } from './adapter';
import { diffWindowFromCron } from './cadence';
import {
  type DroppedComponent,
  type ReviewerDraft,
  type WorkflowDraft,
} from './workflow-draft';
import type { AssemblyPresets } from './workflow-input';

export interface AssembleContext {
  repo: { owner: string; name: string };
  platform: TriggerSource;
  /** Repo default branch — baked into each generated cron trigger. */
  defaultBranch: string;
  presets: AssemblyPresets;
}

export interface AssembleResult {
  /** Validated bundle, or `null` when no component survived. */
  bundle: TemplateFile | null;
  /** Components whose draft couldn't be turned into a workflow. */
  dropped: DroppedComponent[];
}

/** A reviewer resolved into a safe, unique node identity. */
interface ResolvedReviewer {
  /** Unique, safe node id derived from the reviewer name (`agent-<slug>`). */
  id: string;
  /** Reviewer name — node name, `.conduit/<name>.md` file, `## <name>` heading. */
  name: string;
  /** Agent-authored reviewer prompt body. */
  instructions: string;
}

/**
 * Stitch surviving per-component `WorkflowDraft`s into one multi-workflow
 * `TemplateFile`. Each draft carries **agent-authored** Scope + reviewer prose;
 * assemble keeps the fixed `Trigger → Scope → N reviewers → Publisher` topology
 * and appends the deterministic I/O-contract glue onto that prose, exactly the
 * way `nightly-review` wires its reviewers but scoped per component. Pure:
 * validation only, no I/O.
 *
 * A draft whose reviewer names all collapse to an empty/duplicate identifier
 * after sanitization is dropped (never silently truncated — it lands in
 * `dropped`). The assembled bundle is validated against `templateFileSchema`; a
 * structural failure throws (the whole analysis fails rather than persisting an
 * unimportable bundle).
 */
export function assembleSuggestionBundle(
  drafts: WorkflowDraft[],
  ctx: AssembleContext,
): AssembleResult {
  const dropped: DroppedComponent[] = [];
  const workflows: TemplateWorkflow[] = [];

  for (const draft of drafts) {
    const reviewers = resolveReviewers(draft.reviewers);
    if (reviewers.length === 0) {
      dropped.push({
        component: draft.component,
        reason: 'every reviewer name collapsed to an empty or duplicate identifier after sanitization',
      });
      continue;
    }
    workflows.push(buildComponentWorkflow(draft, reviewers, ctx));
  }

  if (workflows.length === 0) {
    return { bundle: null, dropped };
  }

  const bundle = templateFileSchema.parse({
    id: 'repo-review-suggestions',
    name: `Review suggestions — ${ctx.repo.owner}/${ctx.repo.name}`,
    description: `Auto-generated per-component review workflows for ${ctx.repo.owner}/${ctx.repo.name}.`,
    category: 'review',
    workflows,
  });

  return { bundle, dropped };
}

/**
 * Turn a reviewer name into a safe, unique node-id slug (`[a-z0-9-]`) so the
 * generated ids stay lowercase-kebab like the fixed `agent-scope` /
 * `agent-publisher` nodes. The schema already restricts names to
 * `NODE_NAME_PATTERN` (`/^[A-Za-z_][A-Za-z0-9_]*$/`) and rejects duplicate
 * names, so the slug's lossy lowercase/collapse is the *only* thing that can
 * reintroduce a collision (`Api_Contract` vs `Api__Contract`) or an empty slug
 * (`___`) — both handled by the dedup in `resolveReviewers`.
 */
function slugifyReviewerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Names of the fixed structural nodes a reviewer may not reuse. The schema's
 * charset rule permits these (`Scope`, `Publisher`, `Trigger` all match
 * `NODE_NAME_PATTERN`), but reusing one collides with a code-owned node: a
 * `Scope`/`Publisher` reviewer duplicates that node's id *and* name (silent
 * graph corruption, since name dedup hides it), and a `Trigger` reviewer trips
 * the trigger-vs-agent name check and throws out the whole bundle. Compared
 * case-insensitively because the slug lowercases anyway.
 */
const RESERVED_NODE_NAMES = new Set(['scope', 'publisher', 'trigger']);

/**
 * Resolve authored reviewers into nodes with safe, unique ids. Reviewers whose
 * name sanitizes to an empty slug, collides with an earlier reviewer's slug, or
 * reuses a reserved structural node name (`Scope`/`Publisher`/`Trigger`) are
 * dropped; the first occurrence wins. Order preserved. If every reviewer is
 * dropped the caller surfaces the component in `dropped` rather than emitting a
 * reviewer-less workflow.
 */
function resolveReviewers(reviewers: ReviewerDraft[]): ResolvedReviewer[] {
  const seen = new Set<string>();
  const out: ResolvedReviewer[] = [];
  for (const reviewer of reviewers) {
    if (RESERVED_NODE_NAMES.has(reviewer.name.toLowerCase())) continue;
    const slug = slugifyReviewerName(reviewer.name);
    if (!slug) continue;
    const id = `agent-${slug}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: reviewer.name, instructions: reviewer.instructions });
  }
  return out;
}

function buildComponentWorkflow(
  draft: WorkflowDraft,
  reviewers: ResolvedReviewer[],
  ctx: AssembleContext,
): TemplateWorkflow {
  const { presets } = ctx;
  const pathList = draft.paths.map((p) => `- ${p}`).join('\n');
  const window = diffWindowFromCron(draft.cron);
  // List the reviewer headings explicitly rather than deferring to the
  // runtime-injected "Parallel downstream" block — that block is suppressed
  // when a node fans out to a single sibling (single-reviewer components).
  const reviewerHeadings = reviewers.map((r) => `- \`## ${r.name}\``).join('\n');

  const scopeNode = {
    id: 'agent-scope',
    name: 'Scope',
    provider: presets.scope.provider,
    model: presets.scope.model,
    instructions: appendInstructions(
      draft.scopeInstructions,
      `This pipeline reviews the **${draft.component}** component. Scope every step to changes under these paths only:\n${pathList}\n\nIdentify what changed under those paths over ${window} using git history, then write one section per reviewer to \`.conduit/ScopeManifest.md\` using exactly these headings:\n${reviewerHeadings}\n\nUnder each heading list the relevant changed files with a one-line focus note (or "Nothing relevant" if none apply). If nothing under those paths changed in that window, write "NO_CHANGES" to \`.conduit/ScopeManifest.md\` and stop.`,
    ),
    mcpServers: [],
    skills: [],
    webSearch: false,
  };

  const reviewerNodes = reviewers.map((reviewer) => ({
    id: reviewer.id,
    name: reviewer.name,
    provider: presets.codeAnalyst.provider,
    model: presets.codeAnalyst.model,
    instructions: appendInstructions(reviewer.instructions, reviewerGlue(reviewer.name)),
    mcpServers: [],
    skills: [],
    webSearch: false,
  }));

  const reviewerNames = reviewers.map((r) => r.name).join(', ');
  const summaryReads = reviewers.map((r) => `\`.conduit/${r.name}.md\``).join(', ');
  const publisherNode = {
    id: 'agent-publisher',
    name: 'Publisher',
    provider: presets.issuePublisher.provider,
    model: presets.issuePublisher.model,
    instructions: appendInstructions(
      presets.issuePublisher.instructions,
      `The upstream reviewers for the **${draft.component}** component are: ${reviewerNames}. Read ${summaryReads}.\n\n**Severity gate:** only publish findings that are \`medium\`, \`high\`, or \`critical\`. If a finding declares its severity, use it. If a finding has no explicit severity, do not default it to \`low\` — assess the severity yourself from its description and impact, then apply the same threshold. Skip only findings that are declared or assessed as \`low\`. If every finding is \`low\` (or there are none), stop and create nothing.`,
    ),
    mcpServers: [{ serverId: 'github-mcp' }],
    skills: [],
    webSearch: false,
    issueWriteback: {
      allowedStatuses: [],
      allowedLabels: ['conduit-dev', 'conduit-human-review'],
      allowedPrStates: [],
    },
  };

  const mcpPreset = findMcpPresetByPlatform(ctx.platform.toUpperCase() as Platform);
  if (!mcpPreset) {
    throw new Error(`No MCP preset for platform ${ctx.platform}`);
  }

  const edges = [
    { from: 'Trigger', to: 'Scope' },
    ...reviewers.map((r) => ({ from: 'Scope', to: r.name })),
    ...reviewers.map((r) => ({ from: r.name, to: 'Publisher' })),
  ];

  return {
    name: draft.workflowName,
    description: `${draft.summary}\n\nWhy: ${draft.rationale}`,
    definition: {
      triggers: [
        {
          id: 'trigger-review',
          name: 'Trigger',
          platform: ctx.platform,
          connectionId: ANALYSIS_REPO_PLACEHOLDER,
          type: 'cron',
          cron: draft.cron,
          timezone: 'UTC',
          branch: ctx.defaultBranch,
        },
      ],
      nodes: [scopeNode, ...reviewerNodes, publisherNode],
      edges,
      mcpServers: [
        {
          id: 'github-mcp',
          name: mcpPreset.name,
          transport: mcpPreset.transport,
          connectionId: ANALYSIS_REPO_PLACEHOLDER,
          presetId: mcpPreset.id,
        },
      ],
      ui: layout(reviewers.map((r) => r.name)),
    },
  };
}

/**
 * Deterministic I/O-contract glue appended to each authored reviewer prompt:
 * where to read its scoped inputs, where to write findings, and the exact
 * findings/severity format the Publisher's severity gate reads (mirrors the
 * old `code-analyst` preset write format so the gate keeps working). The
 * `Severity:` line is mandatory: a reviewer that drops to a prose summary
 * leaves the Publisher inferring severity, so the format is stated as
 * non-substitutable here.
 */
function reviewerGlue(name: string): string {
  return `Read the \`## ${name}\` section of \`.conduit/ScopeManifest.md\` for the files relevant to your review. If that section reports nothing relevant, or the manifest is \`NO_CHANGES\`, write "No findings" to \`.conduit/${name}.md\` and stop.

For each relevant file, read the actual diff and surrounding context, then write your findings to \`.conduit/${name}.md\` using exactly this format:

\`\`\`
## Findings

### <short title>
- File: <path>
- Lines: <range>
- Severity: critical | high | medium | low
- Confidence: high | low
- Description: <1-2 sentences explaining the issue>
- Suggested fix: <1-2 sentences or "Needs human assessment">
\`\`\`

Only flag real issues with a concrete file path and line range — do not invent findings or flag stylistic preferences. Write every finding as the exact block above — a narrative or prose summary is **not** a substitute. The \`Severity:\` line is required on every finding; if you omit it the downstream Publisher has to infer the severity itself, which it may get wrong.`;
}

function appendInstructions(base: string, append: string): string {
  return `${base}\n\n${append}`;
}

/** Deterministic canvas layout: Trigger → Scope → N stacked reviewers → Publisher. */
function layout(reviewerNames: string[]) {
  const nodePositions: Record<string, { x: number; y: number }> = {
    Trigger: { x: 60, y: 480 },
    Scope: { x: 360, y: 480 },
    Publisher: { x: 1280, y: 480 },
  };
  reviewerNames.forEach((name, i) => {
    nodePositions[name] = { x: 820, y: i * 320 };
  });
  return { nodePositions, viewport: { x: 0, y: 0, zoom: 1 } };
}
