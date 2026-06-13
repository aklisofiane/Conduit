import { describe, expect, it } from 'vitest';
import {
  findMcpPreset,
  type AgentConfig,
  type TriggerConfig,
  type TriggerEvent,
  type WorkflowMcpServer,
} from '@conduit/shared';
import {
  WRITEBACK_GITHUB_MCP_ID,
  agentReferencesGithubMcp,
  buildSyntheticGithubMcp,
  resolveWritebackContext,
} from './writeback';

// Drive matching off the real preset so these stay correct if the GitHub MCP
// transport ever changes (the bug this guards against was exactly the matcher
// assuming a stdio transport while the preset is remote streamable-http).
const GITHUB_TRANSPORT = findMcpPreset('github')!.transport;

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Publisher',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    instructions: '',
    mcpServers: [],
    skills: [],
    webSearch: false,
    ...overrides,
  };
}

const CRON_TRIGGER: TriggerConfig = {
  id: 'trigger-nightly',
  name: 'NightlyTrigger',
  platform: 'github',
  connectionId: 'conn-repo',
  type: 'cron',
  cron: '0 2 * * *',
  timezone: 'UTC',
  branch: 'main',
};

const DEV_LABEL_TRIGGER: TriggerConfig = {
  id: 'trigger-develop',
  name: 'DevelopTrigger',
  platform: 'github',
  connectionId: 'conn-repo',
  type: 'issues',
  intervalSec: 60,
  filters: [{ field: 'label', value: 'conduit-dev' }],
};

const PR_LABEL_TRIGGER: TriggerConfig = {
  id: 'trigger-pr',
  name: 'PrTrigger',
  platform: 'github',
  connectionId: 'conn-repo',
  type: 'pull_requests',
  intervalSec: 60,
  filters: [{ field: 'label', value: 'conduit-review' }],
};

const TODO_STATUS_TRIGGER: TriggerConfig = {
  id: 'trigger-analyze',
  name: 'AnalyzeTrigger',
  platform: 'github',
  connectionId: 'conn-repo',
  type: 'issues',
  intervalSec: 60,
  filters: [{ field: 'status', value: 'Todo' }],
};

const CRON_EVENT: TriggerEvent = {
  source: 'github',
  mode: 'scheduled',
  event: 'cron.fired',
  payload: {},
  repo: { owner: 'acme', name: 'shop' },
};

const ISSUE_EVENT: TriggerEvent = {
  source: 'github',
  mode: 'polling',
  event: 'board.column.changed',
  payload: {},
  repo: { owner: 'acme', name: 'shop' },
  issue: {
    id: 'I_1',
    key: '42',
    title: 'Crash on save',
    url: 'https://github.com/acme/shop/issues/42',
  },
};

const PR_EVENT: TriggerEvent = {
  source: 'github',
  mode: 'polling',
  event: 'pull_request.detected',
  payload: {},
  repo: { owner: 'acme', name: 'shop' },
  // PRs share the issue number space — `issue` is populated for PR events.
  issue: {
    id: 'PR_1',
    key: '7',
    title: 'Add checkout flow',
    url: 'https://github.com/acme/shop/pull/7',
  },
  pr: { headRef: 'feature-checkout', baseRef: 'main' },
};

describe('resolveWritebackContext', () => {
  it('returns undefined when issueWriteback is not configured', () => {
    expect(resolveWritebackContext(makeAgent(), [CRON_TRIGGER], CRON_EVENT)).toBeUndefined();
  });

  it('returns undefined when the allowlist is empty (checkbox on, nothing picked)', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: [], allowedLabels: [], allowedPrStates: [] },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], CRON_EVENT)).toBeUndefined();
  });

  it('returns undefined for a non-GitHub run', () => {
    const node = makeAgent({ issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [], allowedPrStates: [] } });
    const gitlabEvent: TriggerEvent = { ...CRON_EVENT, source: 'gitlab' };
    expect(resolveWritebackContext(node, [CRON_TRIGGER], gitlabEvent)).toBeUndefined();
  });

  it('returns undefined when the run carries no repo', () => {
    const node = makeAgent({ issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [], allowedPrStates: [] } });
    const noRepo: TriggerEvent = {
      source: 'github',
      mode: 'scheduled',
      event: 'cron.fired',
      payload: {},
    };
    expect(resolveWritebackContext(node, [CRON_TRIGGER], noRepo)).toBeUndefined();
  });

  it('resolves a repo-scoped context (issueNumber undefined) for a cron run', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['AIDev', 'Review'], allowedLabels: [], allowedPrStates: [] },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], CRON_EVENT)).toEqual({
      connectionId: 'conn-repo',
      repoOwner: 'acme',
      repoName: 'shop',
      issueNumber: undefined,
      allowedStatuses: ['AIDev', 'Review'],
      allowedLabels: [],
      allowedPrStates: [],
      isPr: false,
      consumedLabels: [],
    });
  });

  it('carries the triggering issue number for an issue-fired run', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: ['bug'], allowedPrStates: [] },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], ISSUE_EVENT)?.issueNumber).toBe('42');
  });

  it('flags an issue-fired run as not a PR', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [], allowedPrStates: [] },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], ISSUE_EVENT)?.isPr).toBe(false);
  });

  it('qualifies a PR run on PR-state allowlist alone (no board status needed)', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: [], allowedLabels: [], allowedPrStates: ['closed'] },
    });
    const ctx = resolveWritebackContext(node, [PR_LABEL_TRIGGER], PR_EVENT);
    expect(ctx?.isPr).toBe(true);
    expect(ctx?.issueNumber).toBe('7');
    expect(ctx?.allowedPrStates).toEqual(['closed']);
    // The PR trigger's gating label is consumed just like an issue trigger's.
    expect(ctx?.consumedLabels).toEqual(['conduit-review']);
  });

  it('derives the consumed label from the trigger’s label filter', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['Review'], allowedLabels: ['conduit-review'], allowedPrStates: [] },
    });
    const ctx = resolveWritebackContext(node, [DEV_LABEL_TRIGGER], ISSUE_EVENT);
    // conduit-dev gated the run → consumed; conduit-review is the one to add.
    expect(ctx?.consumedLabels).toEqual(['conduit-dev']);
    expect(ctx?.allowedLabels).toEqual(['conduit-review']);
  });

  it('does not list a label as consumed when it is also being applied', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: [], allowedLabels: ['conduit-dev'], allowedPrStates: [] },
    });
    // Trigger gates on conduit-dev AND the agent re-applies it → not a removal.
    const ctx = resolveWritebackContext(node, [DEV_LABEL_TRIGGER], ISSUE_EVENT);
    expect(ctx?.consumedLabels).toEqual([]);
  });

  it('has no consumed label for a status-gated trigger', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: [], allowedLabels: ['conduit-dev'], allowedPrStates: [] },
    });
    const ctx = resolveWritebackContext(node, [TODO_STATUS_TRIGGER], ISSUE_EVENT);
    expect(ctx?.consumedLabels).toEqual([]);
  });
});

describe('agentReferencesGithubMcp', () => {
  it('detects the shipped remote (streamable-http) GitHub MCP by url', () => {
    // Regression: the matcher used to only inspect stdio args, so a remote
    // GitHub MCP was never recognized and the writeback server was attached
    // as a duplicate.
    const server: WorkflowMcpServer = {
      id: 'github-mcp',
      name: 'GitHub',
      transport: GITHUB_TRANSPORT,
      connectionId: 'conn-repo',
    };
    const node = makeAgent({ mcpServers: [{ serverId: 'github-mcp' }] });
    expect(agentReferencesGithubMcp(node, [server])).toBe(true);
  });

  it('does not match an unrelated server with a different url', () => {
    const server: WorkflowMcpServer = {
      id: 'other',
      name: 'Other',
      transport: { kind: 'streamable-http', url: 'https://example.com/mcp/' },
    };
    const node = makeAgent({ mcpServers: [{ serverId: 'other' }] });
    expect(agentReferencesGithubMcp(node, [server])).toBe(false);
  });

  it('returns false when the agent references no servers', () => {
    expect(agentReferencesGithubMcp(makeAgent(), [])).toBe(false);
  });
});

describe('buildSyntheticGithubMcp', () => {
  it('builds the reserved writeback server bound to the given connection', () => {
    const { server, ref } = buildSyntheticGithubMcp('conn-xyz');
    expect(server.id).toBe(WRITEBACK_GITHUB_MCP_ID);
    expect(ref.serverId).toBe(WRITEBACK_GITHUB_MCP_ID);
    expect(server.connectionId).toBe('conn-xyz');
    expect(server.transport).toEqual(GITHUB_TRANSPORT);
  });

  it('produces a server that agentReferencesGithubMcp itself recognizes', () => {
    // Couples the two helpers: whatever transport auto-attach uses must be
    // detectable by the duplicate-skip guard, or a second pass would attach
    // yet another copy.
    const { server, ref } = buildSyntheticGithubMcp('conn-xyz');
    const node = makeAgent({ mcpServers: [ref] });
    expect(agentReferencesGithubMcp(node, [server])).toBe(true);
  });
});
