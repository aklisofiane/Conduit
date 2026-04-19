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
