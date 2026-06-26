import type { TriggerSource } from '../platform/index';
import { findMcpPresetByPlatform } from '../mcp/index';
import {
  templateFileSchema,
  type TemplateFile,
  type TemplateWorkflow,
} from '../template/schema';
import { ANALYSIS_REPO_PLACEHOLDER } from './adapter';
import { findReviewerDomain, type ReviewerDomain } from './reviewer-domains';
import {
  type DroppedComponent,
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

const PLATFORM_FOR_SOURCE = { github: 'GITHUB', gitlab: 'GITLAB', jira: 'JIRA' } as const;

/**
 * Stitch surviving per-component `WorkflowDraft`s into one multi-workflow
 * `TemplateFile`, mapping each selected domain key through `REVIEWER_DOMAINS`
 * to a concrete `code-analyst` node — exactly how `nightly-review` wires its
 * reviewers, but scoped per component. Pure: validation only, no I/O.
 *
 * A draft that maps to zero known domains is dropped (never silently
 * truncated — it lands in `dropped`). The assembled bundle is validated
 * against `templateFileSchema`; a structural failure throws (the whole
 * analysis fails rather than persisting an unimportable bundle).
 */
export function assembleSuggestionBundle(
  drafts: WorkflowDraft[],
  ctx: AssembleContext,
): AssembleResult {
  const dropped: DroppedComponent[] = [];
  const workflows: TemplateWorkflow[] = [];

  for (const draft of drafts) {
    const domains = resolveDomains(draft.domains);
    if (domains.length === 0) {
      dropped.push({
        component: draft.component,
        reason: 'no recognized reviewer domains were selected',
      });
      continue;
    }
    workflows.push(buildComponentWorkflow(draft, domains, ctx));
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

/** Map selected keys to catalog domains, dedup by key, preserve order. */
function resolveDomains(keys: string[]): ReviewerDomain[] {
  const seen = new Set<string>();
  const out: ReviewerDomain[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    const domain = findReviewerDomain(key);
    if (!domain) continue;
    seen.add(key);
    out.push(domain);
  }
  return out;
}

function buildComponentWorkflow(
  draft: WorkflowDraft,
  domains: ReviewerDomain[],
  ctx: AssembleContext,
): TemplateWorkflow {
  const { presets } = ctx;
  const pathList = draft.paths.map((p) => `- ${p}`).join('\n');
  const window = diffWindowFromCron(draft.cron);
  // List the domains explicitly rather than deferring to the runtime-injected
  // "Parallel downstream" block — that block is suppressed when a node fans out
  // to a single sibling, which happens for single-domain components.
  const domainHeadings = domains.map((d) => `- \`## ${d.name}\``).join('\n');

  const scopeNode = {
    id: 'agent-scope',
    name: 'Scope',
    provider: presets.scope.provider,
    model: presets.scope.model,
    instructions: appendInstructions(
      presets.scope.instructions,
      `This pipeline reviews the **${draft.component}** component. Scope every step to changes under these paths only:\n${pathList}\n\nIdentify what changed under those paths over ${window} using git history, then write one section per review domain to \`.conduit/ScopeManifest.md\` using exactly these headings:\n${domainHeadings}\n\nUnder each heading list the relevant changed files with a one-line focus note (or "Nothing <domain>-relevant" if none apply). If nothing under those paths changed in that window, write "NO_CHANGES" to \`.conduit/ScopeManifest.md\` and stop.`,
    ),
    mcpServers: [],
    skills: [],
    webSearch: false,
  };

  const domainNodes = domains.map((domain) => ({
    id: `agent-${domain.key}`,
    name: domain.name,
    provider: presets.codeAnalyst.provider,
    model: presets.codeAnalyst.model,
    instructions: appendInstructions(presets.codeAnalyst.instructions, domain.instructionsAppend),
    mcpServers: [],
    skills: [],
    webSearch: false,
  }));

  const reviewerNames = domains.map((d) => d.name).join(', ');
  const summaryReads = domains.map((d) => `\`.conduit/${d.name}.md\``).join(', ');
  const publisherNode = {
    id: 'agent-publisher',
    name: 'Publisher',
    provider: presets.issuePublisher.provider,
    model: presets.issuePublisher.model,
    instructions: appendInstructions(
      presets.issuePublisher.instructions,
      `The upstream reviewers for the **${draft.component}** component are: ${reviewerNames}. Read ${summaryReads}.\n\n**Severity gate:** only publish findings with a severity of \`medium\`, \`high\`, or \`critical\`. Skip any finding marked \`low\` (or with no severity) entirely. If every finding is \`low\` (or there are none), stop and create nothing.`,
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

  const mcpPreset = findMcpPresetByPlatform(PLATFORM_FOR_SOURCE[ctx.platform]);
  if (!mcpPreset) {
    throw new Error(`No MCP preset for platform ${ctx.platform}`);
  }

  const edges = [
    { from: 'Trigger', to: 'Scope' },
    ...domains.map((d) => ({ from: 'Scope', to: d.name })),
    ...domains.map((d) => ({ from: d.name, to: 'Publisher' })),
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
      nodes: [scopeNode, ...domainNodes, publisherNode],
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
      ui: layout(domains.map((d) => d.name)),
    },
  };
}

function appendInstructions(base: string, append: string): string {
  return `${base}\n\n${append}`;
}

/** Deterministic canvas layout: Trigger → Scope → N stacked reviewers → Publisher. */
function layout(domainNames: string[]) {
  const nodePositions: Record<string, { x: number; y: number }> = {
    Trigger: { x: 60, y: 480 },
    Scope: { x: 360, y: 480 },
    Publisher: { x: 1280, y: 480 },
  };
  domainNames.forEach((name, i) => {
    nodePositions[name] = { x: 820, y: i * 320 };
  });
  return { nodePositions, viewport: { x: 0, y: 0, zoom: 1 } };
}

/**
 * Prose diff window aligned with the chosen cadence. The `scope` preset bakes
 * a 24h window, so the actual window rides on `instructionsAppend`. Coarse by
 * design — daily cadence → a day, weekly → a week, monthly → a month.
 */
function diffWindowFromCron(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  const dom = fields[2] ?? '*';
  const dow = fields[4] ?? '*';
  if (dom !== '*') return 'the last 30 days';
  if (dow !== '*') return 'the last 7 days';
  return 'the last 24 hours';
}
