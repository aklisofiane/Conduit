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

describe('resolveWritebackContext', () => {
  it('returns undefined when issueWriteback is not configured', () => {
    expect(resolveWritebackContext(makeAgent(), [CRON_TRIGGER], CRON_EVENT)).toBeUndefined();
  });

  it('returns undefined when the allowlist is empty (checkbox on, nothing picked)', () => {
    const node = makeAgent({ issueWriteback: { allowedStatuses: [], allowedLabels: [] } });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], CRON_EVENT)).toBeUndefined();
  });

  it('returns undefined for a non-GitHub run', () => {
    const node = makeAgent({ issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [] } });
    const gitlabEvent: TriggerEvent = { ...CRON_EVENT, source: 'gitlab' };
    expect(resolveWritebackContext(node, [CRON_TRIGGER], gitlabEvent)).toBeUndefined();
  });

  it('returns undefined when the run carries no repo', () => {
    const node = makeAgent({ issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [] } });
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
      issueWriteback: { allowedStatuses: ['AIDev', 'Review'], allowedLabels: [] },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], CRON_EVENT)).toEqual({
      connectionId: 'conn-repo',
      repoOwner: 'acme',
      repoName: 'shop',
      issueNumber: undefined,
      allowedStatuses: ['AIDev', 'Review'],
      allowedLabels: [],
    });
  });

  it('carries the triggering issue number for an issue-fired run', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: ['bug'] },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], ISSUE_EVENT)?.issueNumber).toBe('42');
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
