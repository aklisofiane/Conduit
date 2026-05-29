import { describe, expect, it } from 'vitest';
import { normalizeGithubWebhook } from './github';

const BASE_REPO = {
  name: 'shop',
  owner: { login: 'acme' },
};

describe('normalizeGithubWebhook', () => {
  it('normalizes issues.opened', () => {
    const evt = normalizeGithubWebhook('issues', {
      action: 'opened',
      repository: BASE_REPO,
      sender: { login: 'alice' },
      issue: {
        id: 12345,
        node_id: 'I_kgDOxxxx',
        number: 42,
        title: 'Crash in checkout',
        html_url: 'https://github.com/acme/shop/issues/42',
      },
    });

    expect(evt).toMatchObject({
      source: 'github',
      mode: 'webhook',
      event: 'issues.opened',
      repo: { owner: 'acme', name: 'shop' },
      actor: 'alice',
      issue: {
        id: 'I_kgDOxxxx',
        key: '42',
        title: 'Crash in checkout',
        url: 'https://github.com/acme/shop/issues/42',
      },
    });
  });

  it('normalizes pull_request.opened', () => {
    const evt = normalizeGithubWebhook('pull_request', {
      action: 'opened',
      repository: BASE_REPO,
      sender: { login: 'bob' },
      pull_request: {
        id: 999,
        node_id: 'PR_kgDOxxxx',
        number: 7,
        title: 'Wire up checkout retry',
        html_url: 'https://github.com/acme/shop/pull/7',
        head: {
          ref: 'conduit/7-wire-up-checkout-retry',
          repo: { name: 'shop', owner: { login: 'acme' } },
        },
        base: {
          ref: 'main',
          repo: { name: 'shop', owner: { login: 'acme' } },
        },
      },
    });

    expect(evt?.event).toBe('pull_request.opened');
    expect(evt?.issue?.key).toBe('7');
    expect(evt?.pr).toEqual({
      headRef: 'conduit/7-wire-up-checkout-retry',
      baseRef: 'main',
    });
  });

  it('marks pr.headRepo on fork PRs', () => {
    const evt = normalizeGithubWebhook('pull_request', {
      action: 'opened',
      repository: BASE_REPO,
      pull_request: {
        node_id: 'PR_fork',
        number: 12,
        title: 'External contribution',
        html_url: 'https://github.com/acme/shop/pull/12',
        head: {
          ref: 'patch-1',
          repo: { name: 'shop', owner: { login: 'forker' } },
        },
        base: {
          ref: 'main',
          repo: { name: 'shop', owner: { login: 'acme' } },
        },
      },
    });

    expect(evt?.pr).toEqual({
      headRef: 'patch-1',
      baseRef: 'main',
      headRepo: { owner: 'forker', name: 'shop' },
    });
  });

  it('leaves pr undefined when pull_request payload omits head/base refs', () => {
    const evt = normalizeGithubWebhook('pull_request', {
      action: 'opened',
      repository: BASE_REPO,
      pull_request: {
        node_id: 'PR_minimal',
        number: 13,
        title: 'Minimal payload',
        html_url: 'https://github.com/acme/shop/pull/13',
      },
    });

    expect(evt?.event).toBe('pull_request.opened');
    expect(evt?.pr).toBeUndefined();
  });

  it('normalizes issue_comment.created only for PR comments', () => {
    const prComment = normalizeGithubWebhook('issue_comment', {
      action: 'created',
      repository: BASE_REPO,
      sender: { login: 'carol' },
      issue: {
        number: 7,
        node_id: 'PR_kgDO',
        title: 'Wire up checkout retry',
        html_url: 'https://github.com/acme/shop/issues/7',
        pull_request: { url: 'https://api.github.com/...' },
      },
      comment: { body: 'please adjust' },
    });
    expect(prComment?.event).toBe('issue_comment.created');

    const issueComment = normalizeGithubWebhook('issue_comment', {
      action: 'created',
      repository: BASE_REPO,
      sender: { login: 'carol' },
      issue: {
        number: 8,
        title: 'Just a plain issue',
        html_url: 'https://github.com/acme/shop/issues/8',
      },
      comment: { body: 'thoughts' },
    });
    expect(issueComment).toBeNull();
  });

  it('normalizes projects_v2_item column change → board.column.changed', () => {
    const evt = normalizeGithubWebhook('projects_v2_item', {
      action: 'edited',
      organization: { login: 'acme' },
      sender: { login: 'alice' },
      projects_v2_item: {
        node_id: 'PVTI_xxx',
        content_node_id: 'I_kgDOxxxx',
        content_type: 'Issue',
        project_node_id: 'PVT_xxx',
      },
      changes: {
        field_value: {
          field_name: 'Status',
          field_type: 'single_select',
          project_number: 5,
          from: { name: 'Todo' },
          to: { name: 'Dev' },
        },
      },
    });

    expect(evt).toMatchObject({
      source: 'github',
      mode: 'webhook',
      event: 'board.column.changed',
      actor: 'alice',
    });
    // Webhook payload has no issue number — downstream agents resolve via MCP.
    expect(evt?.issue).toBeUndefined();
    expect(evt?.repo).toBeUndefined();
  });

  it('drops projects_v2_item edits of non-single-select fields', () => {
    const evt = normalizeGithubWebhook('projects_v2_item', {
      action: 'edited',
      organization: { login: 'acme' },
      projects_v2_item: { node_id: 'PVTI_xxx', content_type: 'Issue' },
      changes: {
        field_value: {
          field_name: 'Priority',
          field_type: 'number',
          from: { name: '1' },
          to: { name: '2' },
        },
      },
    });
    expect(evt).toBeNull();
  });

  it('drops projects_v2_item non-edited actions (created/deleted/reordered)', () => {
    expect(
      normalizeGithubWebhook('projects_v2_item', {
        action: 'created',
        projects_v2_item: { node_id: 'PVTI_xxx' },
      }),
    ).toBeNull();
  });

  it('returns null for unsupported actions', () => {
    expect(
      normalizeGithubWebhook('issues', {
        action: 'closed',
        repository: BASE_REPO,
        issue: { number: 1, title: 'x', html_url: 'https://x' },
      }),
    ).toBeNull();
  });

  it('returns null for unsupported event types', () => {
    expect(
      normalizeGithubWebhook('push', { repository: BASE_REPO, ref: 'refs/heads/main' }),
    ).toBeNull();
  });

  it('tolerates missing repository / sender without crashing', () => {
    const evt = normalizeGithubWebhook('issues', {
      action: 'opened',
      issue: { number: 1, title: 'x', html_url: 'https://x' },
    });
    expect(evt?.repo).toBeUndefined();
    expect(evt?.actor).toBeUndefined();
  });

  it('truncates oversized issue body on issues.opened', () => {
    const longBody = 'x'.repeat(64 * 1024 + 500);
    const evt = normalizeGithubWebhook('issues', {
      action: 'opened',
      repository: BASE_REPO,
      sender: { login: 'alice' },
      issue: {
        id: 99,
        node_id: 'I_kgBIG',
        number: 100,
        title: 'Huge body',
        html_url: 'https://github.com/acme/shop/issues/100',
        body: longBody,
      },
    });

    expect(evt?.issue?.body).toBeDefined();
    expect(evt?.issue?.body).toMatch(/\n\n\[truncated\]$/);
    expect(evt?.issue?.body?.length).toBe(64 * 1024 + '\n\n[truncated]'.length);
  });

  it('truncates oversized PR body on pull_request.opened', () => {
    const longBody = 'y'.repeat(64 * 1024 + 500);
    const evt = normalizeGithubWebhook('pull_request', {
      action: 'opened',
      repository: BASE_REPO,
      sender: { login: 'bob' },
      pull_request: {
        id: 200,
        node_id: 'PR_kgBIG',
        number: 20,
        title: 'Huge PR body',
        html_url: 'https://github.com/acme/shop/pull/20',
        body: longBody,
        head: {
          ref: 'conduit/20-huge-pr-body',
          repo: { name: 'shop', owner: { login: 'acme' } },
        },
        base: {
          ref: 'main',
          repo: { name: 'shop', owner: { login: 'acme' } },
        },
      },
    });

    expect(evt?.issue?.body).toBeDefined();
    expect(evt?.issue?.body).toMatch(/\n\n\[truncated\]$/);
    expect(evt?.issue?.body?.length).toBe(64 * 1024 + '\n\n[truncated]'.length);
  });

  it('passes through normal-sized body unchanged on issues.opened', () => {
    const evt = normalizeGithubWebhook('issues', {
      action: 'opened',
      repository: BASE_REPO,
      sender: { login: 'alice' },
      issue: {
        id: 101,
        node_id: 'I_kgNORM',
        number: 101,
        title: 'Normal issue',
        html_url: 'https://github.com/acme/shop/issues/101',
        body: 'Normal body text',
      },
    });

    expect(evt?.issue?.body).toBe('Normal body text');
  });

  it('returns null for garbage input', () => {
    expect(normalizeGithubWebhook('issues', null)).toBeNull();
    expect(normalizeGithubWebhook('issues', 'not-an-object')).toBeNull();
    expect(normalizeGithubWebhook('issues', undefined)).toBeNull();
  });
});
