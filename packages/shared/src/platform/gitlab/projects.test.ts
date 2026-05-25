import { describe, expect, it } from 'vitest';
import { fetchGitlabProjectIssues, fetchGitlabProjectMergeRequests } from './projects';

/**
 * Mapper + pagination tests — stub `fetchImpl` with canned REST responses
 * so the normalizer's shape is locked to real GitLab v4 JSON without network.
 */
describe('fetchGitlabProjectIssues', () => {
  it('maps GitLab issue fields to ProjectBoardItem shape', async () => {
    const canned = [
      {
        id: 100,
        iid: 42,
        title: 'Crash in checkout',
        web_url: 'https://gitlab.com/acme/api/-/issues/42',
        labels: ['bug', 'p0'],
      },
    ];

    const fakeFetch = makeFetch([canned]);
    const items = await fetchGitlabProjectIssues({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      itemNodeId: '100',
      contentNodeId: '100',
      contentType: 'Issue',
      contentKey: '42',
      contentTitle: 'Crash in checkout',
      contentUrl: 'https://gitlab.com/acme/api/-/issues/42',
      repo: { owner: 'acme', name: 'api' },
      singleSelectValues: {},
      labels: ['bug', 'p0'],
    });
  });

  it('returns empty array when no issues exist', async () => {
    const fakeFetch = makeFetch([[]]);
    const items = await fetchGitlabProjectIssues({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(items).toEqual([]);
  });

  it('handles empty labels array', async () => {
    const canned = [
      { id: 1, iid: 1, title: 't', web_url: 'https://x', labels: [] },
    ];
    const fakeFetch = makeFetch([canned]);
    const items = await fetchGitlabProjectIssues({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(items[0]!.labels).toEqual([]);
  });

  it('paginates until a partial page is returned', async () => {
    // Page 1: full page (100 items) → fetch next page.
    // Page 2: partial page (1 item) → stop.
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      iid: i,
      title: `issue-${i}`,
      web_url: `https://x/${i}`,
      labels: [],
    }));
    const page2 = [
      { id: 200, iid: 200, title: 'last', web_url: 'https://x/200', labels: [] },
    ];

    const calls: string[] = [];
    const fakeFetch = makeFetch([page1, page2], (url) => calls.push(url));
    const items = await fetchGitlabProjectIssues({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(items).toHaveLength(101);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('page=1');
    expect(calls[1]).toContain('page=2');
  });

  it('stops at MAX_PAGES ceiling', async () => {
    // All pages are full → should stop at page 40.
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      iid: i,
      title: `issue-${i}`,
      web_url: `https://x/${i}`,
      labels: [],
    }));
    const calls: string[] = [];
    // Always return a full page so pagination never terminates naturally.
    const fakeFetch = makeFetch(
      Array.from({ length: 50 }, () => fullPage),
      (url) => calls.push(url),
    );

    const items = await fetchGitlabProjectIssues({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(calls).toHaveLength(40);
    expect(items).toHaveLength(4000);
  });

  it('URL-encodes subgroup project paths', async () => {
    let seenUrl = '';
    const fakeFetch = makeFetch([[]], (url) => { seenUrl = url; });
    await fetchGitlabProjectIssues({
      hostUrl: 'gitlab.com',
      projectPath: 'group/subgroup/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(seenUrl).toContain('/projects/group%2Fsubgroup%2Fapi/issues');
  });

  it('derives owner/name from subgroup paths', async () => {
    const canned = [
      { id: 1, iid: 1, title: 't', web_url: 'https://x', labels: [] },
    ];
    const fakeFetch = makeFetch([canned]);
    const items = await fetchGitlabProjectIssues({
      hostUrl: 'gitlab.com',
      projectPath: 'group/subgroup/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(items[0]!.repo).toEqual({ owner: 'group/subgroup', name: 'api' });
  });

  it('throws with error shape on non-2xx response', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('Not Found', { status: 404 });
    await expect(
      fetchGitlabProjectIssues({
        hostUrl: 'gitlab.com',
        projectPath: 'acme/api',
        token: 't',
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow(/GitLab REST HTTP 404/);
  });
});

describe('fetchGitlabProjectMergeRequests', () => {
  it('maps GitLab MR fields to ProjectBoardItem shape with pr block', async () => {
    const canned = [
      {
        id: 300,
        iid: 7,
        title: 'Add auth',
        web_url: 'https://gitlab.com/acme/api/-/merge_requests/7',
        labels: ['enhancement'],
        source_branch: 'feature-auth',
        target_branch: 'main',
        draft: false,
      },
    ];

    const fakeFetch = makeFetch([canned]);
    const items = await fetchGitlabProjectMergeRequests({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      itemNodeId: '300',
      contentNodeId: '300',
      contentType: 'PullRequest',
      contentKey: '7',
      contentTitle: 'Add auth',
      contentUrl: 'https://gitlab.com/acme/api/-/merge_requests/7',
      repo: { owner: 'acme', name: 'api' },
      singleSelectValues: {},
      labels: ['enhancement'],
      pr: {
        headRef: 'feature-auth',
        baseRef: 'main',
        state: 'ready_for_review',
      },
    });
  });

  it('maps draft MR to draft state', async () => {
    const canned = [
      {
        id: 301,
        iid: 8,
        title: 'WIP',
        web_url: 'https://gitlab.com/acme/api/-/merge_requests/8',
        labels: [],
        source_branch: 'wip-branch',
        target_branch: 'main',
        draft: true,
      },
    ];

    const fakeFetch = makeFetch([canned]);
    const items = await fetchGitlabProjectMergeRequests({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(items[0]!.pr).toEqual({
      headRef: 'wip-branch',
      baseRef: 'main',
      state: 'draft',
    });
  });

  it('paginates until a partial page is returned', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      iid: i,
      title: `mr-${i}`,
      web_url: `https://x/${i}`,
      labels: [],
      source_branch: 'src',
      target_branch: 'main',
      draft: false,
    }));
    const page2 = [
      {
        id: 200,
        iid: 200,
        title: 'last',
        web_url: 'https://x/200',
        labels: [],
        source_branch: 'src',
        target_branch: 'main',
        draft: false,
      },
    ];

    const calls: string[] = [];
    const fakeFetch = makeFetch([page1, page2], (url) => calls.push(url));
    const items = await fetchGitlabProjectMergeRequests({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(items).toHaveLength(101);
    expect(calls).toHaveLength(2);
  });

  it('throws with error shape on non-2xx response', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('Unauthorized', { status: 401 });
    await expect(
      fetchGitlabProjectMergeRequests({
        hostUrl: 'gitlab.com',
        projectPath: 'acme/api',
        token: 't',
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow(/GitLab REST HTTP 401/);
  });

  it('URL-encodes subgroup project paths', async () => {
    let seenUrl = '';
    const fakeFetch = makeFetch([[]], (url) => { seenUrl = url; });
    await fetchGitlabProjectMergeRequests({
      hostUrl: 'gitlab.com',
      projectPath: 'group/subgroup/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(seenUrl).toContain('/projects/group%2Fsubgroup%2Fapi/merge_requests');
  });
});

// ── Test helpers ─────────────────────────────────────────────────────────

function makeFetch(
  pages: unknown[],
  onCall?: (url: string) => void,
): typeof fetch {
  let call = 0;
  return (async (url: string) => {
    onCall?.(url);
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return new Response(JSON.stringify(page), { status: 200 });
  }) as typeof fetch;
}
