import { describe, expect, it } from 'vitest';
import { normalizeGitlabWebhook } from './gitlab';

const BASE_PROJECT = {
  path_with_namespace: 'acme/shop',
};

const BASE_USER = {
  username: 'alice',
};

describe('normalizeGitlabWebhook', () => {
  // -------------------------------------------------------------------------
  // Issue Hook
  // -------------------------------------------------------------------------

  it('normalizes Issue Hook (open)', () => {
    const evt = normalizeGitlabWebhook('Issue Hook', {
      user: BASE_USER,
      project: BASE_PROJECT,
      object_attributes: {
        id: 301,
        iid: 42,
        title: 'Crash in checkout',
        url: 'https://gitlab.com/acme/shop/-/issues/42',
        action: 'open',
      },
    });

    expect(evt).toMatchObject({
      source: 'gitlab',
      mode: 'webhook',
      event: 'issues.opened',
      repo: { owner: 'acme', name: 'shop' },
      actor: 'alice',
      issue: {
        id: '301',
        key: '42',
        title: 'Crash in checkout',
        url: 'https://gitlab.com/acme/shop/-/issues/42',
      },
    });
  });

  it('drops Issue Hook with action "update"', () => {
    expect(
      normalizeGitlabWebhook('Issue Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: { id: 1, iid: 1, title: 'x', url: 'https://x', action: 'update' },
      }),
    ).toBeNull();
  });

  it('drops Issue Hook with action "close"', () => {
    expect(
      normalizeGitlabWebhook('Issue Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: { id: 1, iid: 1, title: 'x', url: 'https://x', action: 'close' },
      }),
    ).toBeNull();
  });

  it('drops Issue Hook with action "reopen"', () => {
    expect(
      normalizeGitlabWebhook('Issue Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: { id: 1, iid: 1, title: 'x', url: 'https://x', action: 'reopen' },
      }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Merge Request Hook
  // -------------------------------------------------------------------------

  it('normalizes Merge Request Hook (open)', () => {
    const evt = normalizeGitlabWebhook('Merge Request Hook', {
      user: { username: 'bob' },
      project: BASE_PROJECT,
      object_attributes: {
        id: 401,
        iid: 7,
        title: 'Wire up checkout retry',
        url: 'https://gitlab.com/acme/shop/-/merge_requests/7',
        action: 'open',
        source_branch: 'conduit/7-wire-up-checkout-retry',
        target_branch: 'main',
      },
    });

    expect(evt?.event).toBe('pull_request.opened');
    expect(evt?.source).toBe('gitlab');
    expect(evt?.issue?.key).toBe('7');
    expect(evt?.pr).toEqual({
      headRef: 'conduit/7-wire-up-checkout-retry',
      baseRef: 'main',
    });
    expect(evt?.actor).toBe('bob');
  });

  it('drops Merge Request Hook with action "update"', () => {
    expect(
      normalizeGitlabWebhook('Merge Request Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: {
          id: 1,
          iid: 1,
          title: 'x',
          url: 'https://x',
          action: 'update',
          source_branch: 'a',
          target_branch: 'b',
        },
      }),
    ).toBeNull();
  });

  it('drops Merge Request Hook with action "close"', () => {
    expect(
      normalizeGitlabWebhook('Merge Request Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: {
          id: 1,
          iid: 1,
          title: 'x',
          url: 'https://x',
          action: 'close',
          source_branch: 'a',
          target_branch: 'b',
        },
      }),
    ).toBeNull();
  });

  it('leaves pr undefined when source_branch / target_branch are missing', () => {
    const evt = normalizeGitlabWebhook('Merge Request Hook', {
      user: BASE_USER,
      project: BASE_PROJECT,
      object_attributes: {
        id: 501,
        iid: 10,
        title: 'Minimal MR',
        url: 'https://gitlab.com/acme/shop/-/merge_requests/10',
        action: 'open',
      },
    });
    expect(evt?.event).toBe('pull_request.opened');
    expect(evt?.pr).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Note Hook
  // -------------------------------------------------------------------------

  it('normalizes Note Hook on MergeRequest', () => {
    const evt = normalizeGitlabWebhook('Note Hook', {
      user: { username: 'carol' },
      project: BASE_PROJECT,
      object_attributes: {
        id: 601,
        note: 'Looks good.',
        noteable_type: 'MergeRequest',
        noteable_id: 401,
        url: 'https://gitlab.com/acme/shop/-/merge_requests/7#note_601',
      },
      merge_request: {
        id: 401,
        iid: 7,
        title: 'Fix checkout crash on empty cart',
        url: 'https://gitlab.com/acme/shop/-/merge_requests/7',
        source_branch: 'fix/checkout-empty-cart',
        target_branch: 'main',
      },
    });

    expect(evt?.event).toBe('issue_comment.created');
    expect(evt?.source).toBe('gitlab');
    expect(evt?.issue?.key).toBe('7');
    expect(evt?.actor).toBe('carol');
    // PR-comment events do not populate pr (matching GitHub behavior)
    expect(evt?.pr).toBeUndefined();
  });

  it('drops Note Hook on Issue (noteable_type !== MergeRequest)', () => {
    expect(
      normalizeGitlabWebhook('Note Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: {
          id: 602,
          note: 'test',
          noteable_type: 'Issue',
          noteable_id: 301,
        },
        issue: { id: 301, iid: 42, title: 'x', url: 'https://x' },
      }),
    ).toBeNull();
  });

  it('drops Note Hook on Commit', () => {
    expect(
      normalizeGitlabWebhook('Note Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: {
          id: 603,
          note: 'test',
          noteable_type: 'Commit',
          noteable_id: 'abc123',
        },
      }),
    ).toBeNull();
  });

  it('drops Note Hook on Snippet', () => {
    expect(
      normalizeGitlabWebhook('Note Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: {
          id: 604,
          note: 'test',
          noteable_type: 'Snippet',
          noteable_id: 10,
        },
      }),
    ).toBeNull();
  });

  it('returns null for Note Hook on MR when merge_request sub-object is absent', () => {
    expect(
      normalizeGitlabWebhook('Note Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        object_attributes: {
          id: 605,
          note: 'test',
          noteable_type: 'MergeRequest',
          noteable_id: 999,
        },
        // merge_request intentionally absent
      }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Repo extraction
  // -------------------------------------------------------------------------

  it('extracts repo from subgroup path (group/subgroup/project)', () => {
    const evt = normalizeGitlabWebhook('Issue Hook', {
      user: BASE_USER,
      project: { path_with_namespace: 'acme/frontend/shop' },
      object_attributes: { id: 1, iid: 1, title: 'x', url: 'https://x', action: 'open' },
    });
    expect(evt?.repo).toEqual({ owner: 'frontend', name: 'shop' });
  });

  it('leaves repo undefined when project is missing', () => {
    const evt = normalizeGitlabWebhook('Issue Hook', {
      user: BASE_USER,
      object_attributes: { id: 1, iid: 1, title: 'x', url: 'https://x', action: 'open' },
    });
    expect(evt?.repo).toBeUndefined();
  });

  it('leaves repo undefined when path_with_namespace is missing', () => {
    const evt = normalizeGitlabWebhook('Issue Hook', {
      user: BASE_USER,
      project: {},
      object_attributes: { id: 1, iid: 1, title: 'x', url: 'https://x', action: 'open' },
    });
    expect(evt?.repo).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Missing-field guards
  // -------------------------------------------------------------------------

  it('tolerates missing user without crashing', () => {
    const evt = normalizeGitlabWebhook('Issue Hook', {
      project: BASE_PROJECT,
      object_attributes: { id: 1, iid: 1, title: 'x', url: 'https://x', action: 'open' },
    });
    expect(evt?.actor).toBeUndefined();
  });

  it('returns null when object_attributes is missing', () => {
    expect(
      normalizeGitlabWebhook('Issue Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
      }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Unsupported events / garbage
  // -------------------------------------------------------------------------

  it('returns null for unsupported event types', () => {
    expect(
      normalizeGitlabWebhook('Push Hook', {
        user: BASE_USER,
        project: BASE_PROJECT,
        ref: 'refs/heads/main',
      }),
    ).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(normalizeGitlabWebhook('Issue Hook', null)).toBeNull();
    expect(normalizeGitlabWebhook('Issue Hook', 'not-an-object')).toBeNull();
    expect(normalizeGitlabWebhook('Issue Hook', undefined)).toBeNull();
  });
});
