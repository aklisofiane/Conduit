import { describe, expect, it } from 'vitest';
import {
  findMcpPresetByPlatform,
  type AgentConfig,
  type TriggerConfig,
  type TriggerEvent,
  type WorkflowMcpServer,
} from '@conduit/shared';
import {
  agentReferencesWritebackMcp,
  buildSyntheticWritebackMcp,
  resolveWritebackContext,
  writebackMcpId,
} from './writeback';

// Drive matching off the real presets so these stay correct if a writeback MCP
// transport ever changes (the bug this guards against was exactly the matcher
// assuming a stdio transport while the GitHub preset is remote streamable-http).
const GITHUB_TRANSPORT = findMcpPresetByPlatform('GITHUB')!.transport;
const GITLAB_TRANSPORT = findMcpPresetByPlatform('GITLAB')!.transport;

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

const GITLAB_LABEL_TRIGGER: TriggerConfig = {
  id: 'trigger-gl-develop',
  name: 'GitlabDevelopTrigger',
  platform: 'gitlab',
  connectionId: 'conn-gl',
  type: 'issues',
  intervalSec: 60,
  filters: [{ field: 'label', value: 'conduit-dev' }],
};

const GITLAB_ISSUE_EVENT: TriggerEvent = {
  source: 'gitlab',
  mode: 'polling',
  event: 'board.column.changed',
  payload: {},
  repo: { owner: 'acme', name: 'shop' },
  issue: {
    id: 'gid://gitlab/Issue/1',
    key: '42',
    title: 'Crash on save',
    url: 'https://gitlab.com/acme/shop/-/issues/42',
  },
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

  it('returns undefined for a source with no writeback MCP (jira)', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [], allowedPrStates: [] },
    });
    const jiraEvent: TriggerEvent = { ...CRON_EVENT, source: 'jira' };
    expect(resolveWritebackContext(node, [CRON_TRIGGER], jiraEvent)).toBeUndefined();
  });

  it('returns undefined when no trigger matches the firing platform', () => {
    // A GitLab event but only a GitHub trigger configured → no matching trigger.
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [], allowedPrStates: [] },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], GITLAB_ISSUE_EVENT)).toBeUndefined();
  });

  it('resolves a GitLab issue-fired context, deriving the consumed label', () => {
    const node = makeAgent({
      issueWriteback: {
        allowedStatuses: [],
        allowedLabels: ['conduit-review'],
        allowedPrStates: [],
      },
    });
    const ctx = resolveWritebackContext(node, [GITLAB_LABEL_TRIGGER], GITLAB_ISSUE_EVENT);
    expect(ctx).toEqual({
      platform: 'gitlab',
      connectionId: 'conn-gl',
      repoOwner: 'acme',
      repoName: 'shop',
      issueNumber: '42',
      allowedStatuses: [],
      allowedLabels: ['conduit-review'],
      allowedPrStates: [],
      isPr: false,
      // conduit-dev gated the GitLab run → consumed; conduit-review is added.
      consumedLabels: ['conduit-dev'],
    });
  });

  it('tags a GitHub context with platform github', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [], allowedPrStates: [] },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], CRON_EVENT)?.platform).toBe('github');
  });

  it('returns undefined when the run carries no repo', () => {
    const node = makeAgent({
      issueWriteback: { allowedStatuses: ['AIDev'], allowedLabels: [], allowedPrStates: [] },
    });
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
      issueWriteback: {
        allowedStatuses: ['AIDev', 'Review'],
        allowedLabels: [],
        allowedPrStates: [],
      },
    });
    expect(resolveWritebackContext(node, [CRON_TRIGGER], CRON_EVENT)).toEqual({
      platform: 'github',
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
      issueWriteback: {
        allowedStatuses: ['Review'],
        allowedLabels: ['conduit-review'],
        allowedPrStates: [],
      },
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

describe('agentReferencesWritebackMcp', () => {
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
    expect(agentReferencesWritebackMcp(node, [server], 'github')).toBe(true);
  });

  it('does not match an unrelated server with a different url', () => {
    const server: WorkflowMcpServer = {
      id: 'other',
      name: 'Other',
      transport: { kind: 'streamable-http', url: 'https://example.com/mcp/' },
    };
    const node = makeAgent({ mcpServers: [{ serverId: 'other' }] });
    expect(agentReferencesWritebackMcp(node, [server], 'github')).toBe(false);
  });

  it('returns false when the agent references no servers', () => {
    expect(agentReferencesWritebackMcp(makeAgent(), [], 'github')).toBe(false);
  });

  it('detects a user-defined stdio GitLab MCP by shared package args', () => {
    // The GitLab preset is stdio (@zereight/mcp-gitlab); a user who wired their
    // own copy (any id, any GITLAB_API_URL) should suppress auto-attach.
    const server: WorkflowMcpServer = {
      id: 'my-gitlab',
      name: 'My GitLab',
      transport: {
        kind: 'stdio',
        command: 'npx',
        args: ['-y', '@zereight/mcp-gitlab'],
        env: { GITLAB_PERSONAL_ACCESS_TOKEN: 'x', GITLAB_API_URL: 'https://gitlab.acme.io/api/v4' },
      },
      connectionId: 'conn-gl',
    };
    const node = makeAgent({ mcpServers: [{ serverId: 'my-gitlab' }] });
    expect(agentReferencesWritebackMcp(node, [server], 'gitlab')).toBe(true);
  });

  it('does not treat a GitHub MCP as a GitLab reference', () => {
    // Platform-scoped: a remote GitHub server must not suppress GitLab attach.
    const server: WorkflowMcpServer = {
      id: 'github-mcp',
      name: 'GitHub',
      transport: GITHUB_TRANSPORT,
      connectionId: 'conn-repo',
    };
    const node = makeAgent({ mcpServers: [{ serverId: 'github-mcp' }] });
    expect(agentReferencesWritebackMcp(node, [server], 'gitlab')).toBe(false);
  });
});

describe('buildSyntheticWritebackMcp', () => {
  it('builds the reserved GitHub writeback server, byte-identical to before', () => {
    const { server, ref } = buildSyntheticWritebackMcp({
      platform: 'github',
      connectionId: 'conn-xyz',
    });
    expect(server.id).toBe(writebackMcpId('github'));
    expect(server.id).toBe('__conduit_writeback_github__');
    expect(server.name).toBe('GitHub (writeback)');
    expect(ref.serverId).toBe('__conduit_writeback_github__');
    expect(server.connectionId).toBe('conn-xyz');
    expect(server.transport).toEqual(GITHUB_TRANSPORT);
  });

  it('ignores apiBaseUrl for GitHub (preset URL is cloud-only)', () => {
    const { server } = buildSyntheticWritebackMcp({
      platform: 'github',
      connectionId: 'conn-xyz',
      apiBaseUrl: 'https://ghe.acme.io/api/v3',
    });
    expect(server.transport).toEqual(GITHUB_TRANSPORT);
  });

  it('builds the GitLab writeback server from the GitLab preset', () => {
    const { server, ref } = buildSyntheticWritebackMcp({
      platform: 'gitlab',
      connectionId: 'conn-gl',
    });
    expect(server.id).toBe(writebackMcpId('gitlab'));
    expect(server.id).toBe('__conduit_writeback_gitlab__');
    expect(server.name).toBe('GitLab (writeback)');
    expect(ref.serverId).toBe('__conduit_writeback_gitlab__');
    expect(server.connectionId).toBe('conn-gl');
    expect(server.transport).toEqual(GITLAB_TRANSPORT);
  });

  it('leaves GITLAB_API_URL at the gitlab.com default when no host is given', () => {
    // Phase 1: the call site does not resolve a host yet, so cloud GitLab uses
    // the preset's gitlab.com URL untouched.
    const { server } = buildSyntheticWritebackMcp({
      platform: 'gitlab',
      connectionId: 'conn-gl',
    });
    const env = server.transport.kind === 'stdio' ? server.transport.env : undefined;
    expect(env?.GITLAB_API_URL).toBe('https://gitlab.com/api/v4');
    // The credential placeholder is preserved untouched.
    expect(env?.GITLAB_PERSONAL_ACCESS_TOKEN).toBe(
      GITLAB_TRANSPORT.kind === 'stdio'
        ? GITLAB_TRANSPORT.env?.GITLAB_PERSONAL_ACCESS_TOKEN
        : undefined,
    );
  });

  it('overrides GITLAB_API_URL for a self-hosted host, leaving the token placeholder', () => {
    const { server } = buildSyntheticWritebackMcp({
      platform: 'gitlab',
      connectionId: 'conn-gl',
      apiBaseUrl: 'https://gitlab.acme.io:8443/api/v4',
    });
    const env = server.transport.kind === 'stdio' ? server.transport.env : undefined;
    expect(env?.GITLAB_API_URL).toBe('https://gitlab.acme.io:8443/api/v4');
    expect(env?.GITLAB_PERSONAL_ACCESS_TOKEN).toBe(
      GITLAB_TRANSPORT.kind === 'stdio'
        ? GITLAB_TRANSPORT.env?.GITLAB_PERSONAL_ACCESS_TOKEN
        : undefined,
    );
    // The shipped preset is not mutated by the override.
    expect(GITLAB_TRANSPORT.kind === 'stdio' && GITLAB_TRANSPORT.env?.GITLAB_API_URL).toBe(
      'https://gitlab.com/api/v4',
    );
  });

  it('produces a server that agentReferencesWritebackMcp recognizes (both platforms)', () => {
    // Couples the two helpers: whatever transport auto-attach uses must be
    // detectable by the duplicate-skip guard, or a second pass would attach
    // yet another copy.
    for (const platform of ['github', 'gitlab'] as const) {
      const { server, ref } = buildSyntheticWritebackMcp({ platform, connectionId: 'conn-xyz' });
      const node = makeAgent({ mcpServers: [ref] });
      expect(agentReferencesWritebackMcp(node, [server], platform)).toBe(true);
    }
  });
});
