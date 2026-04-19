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
      },
    });

    expect(evt?.event).toBe('pull_request.opened');
    expect(evt?.issue?.key).toBe('7');
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

  it('returns null for garbage input', () => {
    expect(normalizeGithubWebhook('issues', null)).toBeNull();
    expect(normalizeGithubWebhook('issues', 'not-an-object')).toBeNull();
    expect(normalizeGithubWebhook('issues', undefined)).toBeNull();
  });
});
