import { describe, expect, it } from 'vitest';
import {
  fetchProjectBoardItems,
  fetchRepositoryIssues,
  fetchRepositoryPullRequests,
  hydrateGithubItemBodies,
  listProjectBoards,
} from './projects';

/**
 * Mapper tests — we stub `fetch` with a canned GraphQL response so the
 * normalizer's shape is locked to real Projects v2 JSON without network.
 * When GitHub renames a field or adds a new content type, these break
 * before the poll activity does in production.
 */
describe('fetchProjectBoardItems', () => {
  it('flattens project items with single-select field values', async () => {
    const canned = {
      data: {
        owner: {
          projectV2: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'PVTI_issue_in_dev',
                  content: {
                    __typename: 'Issue',
                    id: 'I_1',
                    number: 42,
                    title: 'Crash in checkout',
                    url: 'https://github.com/acme/shop/issues/42',
                    repository: { name: 'shop', owner: { login: 'acme' } },
                  },
                  fieldValues: {
                    nodes: [
                      {
                        __typename: 'ProjectV2ItemFieldSingleSelectValue',
                        name: 'Dev',
                        field: { __typename: 'ProjectV2SingleSelectField', name: 'Status' },
                      },
                      // A non-single-select value should be ignored.
                      { __typename: 'ProjectV2ItemFieldTextValue', text: 'ignored' },
                    ],
                  },
                },
                {
                  id: 'PVTI_draft',
                  content: { __typename: 'DraftIssue', id: 'DI_1', title: 'Brainstorm' },
                  fieldValues: {
                    nodes: [
                      {
                        __typename: 'ProjectV2ItemFieldSingleSelectValue',
                        name: 'Backlog',
                        field: { __typename: 'ProjectV2SingleSelectField', name: 'Status' },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };

    const fakeFetch = makeFetch([canned]);
    const items = await fetchProjectBoardItems(
      { ownerType: 'org', owner: 'acme', projectNumber: 5, token: 't' },
      fakeFetch,
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      itemNodeId: 'PVTI_issue_in_dev',
      contentType: 'Issue',
      contentNodeId: 'I_1',
      contentKey: '42',
      contentTitle: 'Crash in checkout',
      contentUrl: 'https://github.com/acme/shop/issues/42',
      repo: { owner: 'acme', name: 'shop' },
      singleSelectValues: { Status: 'Dev' },
    });
    // Draft items: no repo, no content key — just the item + status.
    expect(items[1]).toMatchObject({
      itemNodeId: 'PVTI_draft',
      contentType: 'DraftIssue',
      singleSelectValues: { Status: 'Backlog' },
    });
    expect(items[1]?.contentKey).toBeUndefined();
    expect(items[1]?.repo).toBeUndefined();
  });

  it('follows pagination via endCursor', async () => {
    const page1 = {
      data: {
        owner: {
          projectV2: {
            items: {
              pageInfo: { hasNextPage: true, endCursor: 'cur1' },
              nodes: [makeItemNode('PVTI_1', 'Dev')],
            },
          },
        },
      },
    };
    const page2 = {
      data: {
        owner: {
          projectV2: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [makeItemNode('PVTI_2', 'Review')],
            },
          },
        },
      },
    };
    const calls: Array<{ after?: string }> = [];
    const fakeFetch = makeFetch([page1, page2], (vars) => {
      calls.push({ after: vars.after as string | undefined });
    });

    const items = await fetchProjectBoardItems(
      { ownerType: 'user', owner: 'alice', projectNumber: 1, token: 't' },
      fakeFetch,
    );

    expect(items.map((i) => i.itemNodeId)).toEqual(['PVTI_1', 'PVTI_2']);
    // First call passes `after: null` (explicit — matches the GraphQL
    // variable type); second call substitutes the previous cursor.
    expect(calls[0]?.after).toBeNull();
    expect(calls[1]?.after).toBe('cur1');
  });

  it('throws a loud error when the project is missing (bad number or scope)', async () => {
    const canned = { data: { owner: { projectV2: null } } };
    const fakeFetch = makeFetch([canned]);
    await expect(
      fetchProjectBoardItems(
        { ownerType: 'user', owner: 'alice', projectNumber: 99, token: 't' },
        fakeFetch,
      ),
    ).rejects.toThrow(/Project v2 #99 not found/);
  });

  it('surfaces GraphQL errors rather than swallowing them', async () => {
    const canned = { errors: [{ message: 'Bad credentials', type: 'UNAUTHORIZED' }] };
    const fakeFetch = makeFetch([canned]);
    await expect(
      fetchProjectBoardItems(
        { ownerType: 'org', owner: 'acme', projectNumber: 5, token: 'bad' },
        fakeFetch,
      ),
    ).rejects.toThrow(/Bad credentials/);
  });

  it('populates `pr` with head/base refs and draft state for PullRequest items', async () => {
    const canned = {
      data: {
        owner: {
          projectV2: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'PVTI_pr_draft',
                  content: {
                    __typename: 'PullRequest',
                    id: 'PR_1',
                    number: 7,
                    title: 'WIP feature',
                    url: 'https://github.com/acme/shop/pull/7',
                    repository: { name: 'shop', owner: { login: 'acme' } },
                    labels: { nodes: [{ name: 'enhancement' }] },
                    isDraft: true,
                    headRefName: 'feature-7',
                    baseRefName: 'main',
                    headRepository: { name: 'shop', owner: { login: 'acme' } },
                  },
                  fieldValues: { nodes: [] },
                },
                {
                  id: 'PVTI_pr_ready_fork',
                  content: {
                    __typename: 'PullRequest',
                    id: 'PR_2',
                    number: 8,
                    title: 'External contributor change',
                    url: 'https://github.com/acme/shop/pull/8',
                    repository: { name: 'shop', owner: { login: 'acme' } },
                    labels: { nodes: [] },
                    isDraft: false,
                    headRefName: 'patch-1',
                    baseRefName: 'main',
                    headRepository: { name: 'shop', owner: { login: 'contributor' } },
                  },
                  fieldValues: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    };
    const fakeFetch = makeFetch([canned]);
    const items = await fetchProjectBoardItems(
      { ownerType: 'org', owner: 'acme', projectNumber: 5, token: 't' },
      fakeFetch,
    );
    expect(items[0]?.pr).toEqual({
      headRef: 'feature-7',
      baseRef: 'main',
      state: 'draft',
    });
    // Same-repo PR: `headRepo` stays undefined so consumers can treat
    // presence as the "fork PR" signal — matches the webhook-side semantic.
    expect(items[0]?.pr?.headRepo).toBeUndefined();
    expect(items[1]?.pr).toEqual({
      headRef: 'patch-1',
      baseRef: 'main',
      state: 'ready_for_review',
      headRepo: { owner: 'contributor', name: 'shop' },
    });
  });

  it('does not populate contentBody from initial fetch (body omitted from query)', async () => {
    const canned = {
      data: {
        owner: {
          projectV2: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'PVTI_issue_with_body',
                  content: {
                    __typename: 'Issue',
                    id: 'I_1',
                    number: 42,
                    title: 't',
                    url: 'https://x',
                    repository: { name: 'shop', owner: { login: 'acme' } },
                  },
                  fieldValues: { nodes: [] },
                },
                {
                  id: 'PVTI_pr_with_body',
                  content: {
                    __typename: 'PullRequest',
                    id: 'PR_1',
                    number: 7,
                    title: 'p',
                    url: 'https://x',
                    repository: { name: 'shop', owner: { login: 'acme' } },
                    isDraft: false,
                    headRefName: 'f',
                    baseRefName: 'main',
                    headRepository: { name: 'shop', owner: { login: 'acme' } },
                  },
                  fieldValues: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    };
    const fakeFetch = makeFetch([canned]);
    const items = await fetchProjectBoardItems(
      { ownerType: 'org', owner: 'acme', projectNumber: 5, token: 't' },
      fakeFetch,
    );
    expect(items[0]?.contentBody).toBeUndefined();
    expect(items[1]?.contentBody).toBeUndefined();
  });

  it('does not populate `pr` for Issue items', async () => {
    const canned = {
      data: {
        owner: {
          projectV2: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'PVTI_issue',
                  content: {
                    __typename: 'Issue',
                    id: 'I_1',
                    number: 1,
                    title: 't',
                    url: 'https://x',
                    repository: { name: 'shop', owner: { login: 'acme' } },
                  },
                  fieldValues: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    };
    const fakeFetch = makeFetch([canned]);
    const items = await fetchProjectBoardItems(
      { ownerType: 'org', owner: 'acme', projectNumber: 5, token: 't' },
      fakeFetch,
    );
    expect(items[0]?.pr).toBeUndefined();
  });

  it('sends Bearer auth + JSON Accept header', async () => {
    const canned = {
      data: {
        owner: {
          projectV2: {
            items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          },
        },
      },
    };
    let seenHeaders: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (_url, init) => {
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify(canned), { status: 200 });
    };
    await fetchProjectBoardItems(
      { ownerType: 'org', owner: 'acme', projectNumber: 5, token: 'tok_123' },
      fakeFetch,
    );
    expect(seenHeaders.Authorization).toBe('Bearer tok_123');
    expect(seenHeaders['Content-Type']).toBe('application/json');
  });
});

describe('listProjectBoards', () => {
  it('returns every project under the owner with their single-select fields', async () => {
    const canned = {
      data: {
        owner: {
          projectsV2: {
            nodes: [
              {
                number: 5,
                title: 'Roadmap Q3',
                url: 'https://github.com/orgs/acme/projects/5',
                fields: {
                  nodes: [
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      name: 'Status',
                      options: [{ name: 'Todo' }, { name: 'In review' }, { name: 'Done' }],
                    },
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      name: 'Priority',
                      options: [{ name: 'P0' }, { name: 'P1' }],
                    },
                    // Non-single-select fields should be ignored.
                    { __typename: 'ProjectV2Field', name: 'Title' },
                    { __typename: 'ProjectV2IterationField', name: 'Sprint' },
                  ],
                },
              },
              {
                number: 6,
                title: 'Bugs',
                url: 'https://github.com/orgs/acme/projects/6',
                fields: { nodes: [] },
              },
            ],
          },
        },
      },
    };
    const fakeFetch = makeFetch([canned]);
    const summaries = await listProjectBoards(
      { ownerType: 'org', owner: 'acme', token: 't' },
      fakeFetch,
    );
    expect(summaries).toEqual([
      {
        number: 5,
        title: 'Roadmap Q3',
        url: 'https://github.com/orgs/acme/projects/5',
        fields: [
          { name: 'Status', options: ['Todo', 'In review', 'Done'] },
          { name: 'Priority', options: ['P0', 'P1'] },
        ],
      },
      {
        number: 6,
        title: 'Bugs',
        url: 'https://github.com/orgs/acme/projects/6',
        fields: [],
      },
    ]);
  });

  it('returns an empty list when the owner has no projects', async () => {
    const canned = { data: { owner: { projectsV2: { nodes: [] } } } };
    const fakeFetch = makeFetch([canned]);
    const summaries = await listProjectBoards(
      { ownerType: 'user', owner: 'alice', token: 't' },
      fakeFetch,
    );
    expect(summaries).toEqual([]);
  });

  it('throws when the owner cannot be resolved', async () => {
    const canned = { data: { owner: null } };
    const fakeFetch = makeFetch([canned]);
    await expect(
      listProjectBoards({ ownerType: 'user', owner: 'unknown', token: 't' }, fakeFetch),
    ).rejects.toThrow(/User "unknown" not found/);
  });

  it('surfaces GraphQL auth errors', async () => {
    const canned = { errors: [{ message: 'Bad credentials', type: 'UNAUTHORIZED' }] };
    const fakeFetch = makeFetch([canned]);
    await expect(
      listProjectBoards({ ownerType: 'org', owner: 'acme', token: 'bad' }, fakeFetch),
    ).rejects.toThrow(/Bad credentials/);
  });
});

describe('fetchRepositoryPullRequests', () => {
  it('flattens repo PRs into ProjectBoardItem shape with pr block + draft state', async () => {
    const canned = {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'PR_node_1',
                number: 7,
                title: 'WIP feature',
                url: 'https://github.com/acme/shop/pull/7',
                isDraft: true,
                headRefName: 'feature-7',
                baseRefName: 'main',
                repository: { name: 'shop', owner: { login: 'acme' } },
                headRepository: { name: 'shop', owner: { login: 'acme' } },
                labels: { nodes: [{ name: 'enhancement' }] },
              },
              {
                id: 'PR_node_2',
                number: 8,
                title: 'Fork PR',
                url: 'https://github.com/acme/shop/pull/8',
                isDraft: false,
                headRefName: 'patch-1',
                baseRefName: 'main',
                repository: { name: 'shop', owner: { login: 'acme' } },
                headRepository: { name: 'shop', owner: { login: 'contributor' } },
                labels: { nodes: [] },
              },
            ],
          },
        },
      },
    };
    const fakeFetch = makeFetch([canned]);
    const items = await fetchRepositoryPullRequests(
      { owner: 'acme', name: 'shop', token: 't' },
      fakeFetch,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      itemNodeId: 'PR_node_1',
      contentNodeId: 'PR_node_1',
      contentType: 'PullRequest',
      contentKey: '7',
      labels: ['enhancement'],
      // No project board → no Status. Other filters (label, pr_state) work
      // unchanged.
      singleSelectValues: {},
      pr: { headRef: 'feature-7', baseRef: 'main', state: 'draft' },
    });
    // Same-repo PR keeps headRepo undefined (fork-PR signal).
    expect(items[0]?.pr?.headRepo).toBeUndefined();
    // Cross-repo (fork) PR surfaces headRepo.
    expect(items[1]?.pr).toEqual({
      headRef: 'patch-1',
      baseRef: 'main',
      state: 'ready_for_review',
      headRepo: { owner: 'contributor', name: 'shop' },
    });
  });

  it('does not populate contentBody from initial fetch (body omitted from query)', async () => {
    const canned = {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'PR_node_3',
                number: 9,
                title: 'with body',
                url: 'https://github.com/acme/shop/pull/9',
                isDraft: false,
                headRefName: 'refactor',
                baseRefName: 'main',
                repository: { name: 'shop', owner: { login: 'acme' } },
                headRepository: { name: 'shop', owner: { login: 'acme' } },
                labels: { nodes: [] },
              },
            ],
          },
        },
      },
    };
    const fakeFetch = makeFetch([canned]);
    const items = await fetchRepositoryPullRequests(
      { owner: 'acme', name: 'shop', token: 't' },
      fakeFetch,
    );
    expect(items[0]?.contentBody).toBeUndefined();
  });

  it('throws when the repo cannot be resolved', async () => {
    const canned = { data: { repository: null } };
    const fakeFetch = makeFetch([canned]);
    await expect(
      fetchRepositoryPullRequests({ owner: 'acme', name: 'missing', token: 't' }, fakeFetch),
    ).rejects.toThrow(/Repository acme\/missing not found/);
  });

  it('surfaces GraphQL errors', async () => {
    const canned = { errors: [{ message: 'Bad credentials', type: 'UNAUTHORIZED' }] };
    const fakeFetch = makeFetch([canned]);
    await expect(
      fetchRepositoryPullRequests({ owner: 'acme', name: 'shop', token: 'bad' }, fakeFetch),
    ).rejects.toThrow(/Bad credentials/);
  });
});

describe('fetchRepositoryIssues', () => {
  it('flattens repo issues into ProjectBoardItem shape (no pr block, empty singleSelectValues)', async () => {
    const canned = {
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'I_1',
                number: 42,
                title: 'Crash on save',
                url: 'https://github.com/acme/shop/issues/42',
                repository: { name: 'shop', owner: { login: 'acme' } },
                labels: { nodes: [{ name: 'bug' }, { name: 'p0' }] },
              },
            ],
          },
        },
      },
    };
    const fakeFetch = makeFetch([canned]);
    const items = await fetchRepositoryIssues(
      { owner: 'acme', name: 'shop', token: 't' },
      fakeFetch,
    );
    expect(items).toEqual([
      {
        itemNodeId: 'I_1',
        contentNodeId: 'I_1',
        contentType: 'Issue',
        contentKey: '42',
        contentTitle: 'Crash on save',
        contentUrl: 'https://github.com/acme/shop/issues/42',
        repo: { owner: 'acme', name: 'shop' },
        singleSelectValues: {},
        labels: ['bug', 'p0'],
      },
    ]);
  });

  it('throws when the repo cannot be resolved', async () => {
    const canned = { data: { repository: null } };
    const fakeFetch = makeFetch([canned]);
    await expect(
      fetchRepositoryIssues({ owner: 'acme', name: 'missing', token: 't' }, fakeFetch),
    ).rejects.toThrow(/Repository acme\/missing not found/);
  });

  it('does not populate contentBody from initial fetch (body omitted from query)', async () => {
    const canned = {
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'I_42',
                number: 42,
                title: 'with body',
                url: 'https://x',
                repository: { name: 'shop', owner: { login: 'acme' } },
                labels: { nodes: [] },
              },
            ],
          },
        },
      },
    };
    const fakeFetch = makeFetch([canned]);
    const items = await fetchRepositoryIssues(
      { owner: 'acme', name: 'shop', token: 't' },
      fakeFetch,
    );
    expect(items[0]?.contentBody).toBeUndefined();
  });
});

describe('hydrateGithubItemBodies', () => {
  it('returns a Map of node IDs to body strings', async () => {
    const canned = {
      data: {
        nodes: [
          { id: 'I_1', body: 'Issue body' },
          { id: 'PR_1', body: 'PR body' },
        ],
      },
    };
    const fakeFetch = makeFetch([canned]);
    const map = await hydrateGithubItemBodies(['I_1', 'PR_1'], 'tok', fakeFetch);
    expect(map.get('I_1')).toBe('Issue body');
    expect(map.get('PR_1')).toBe('PR body');
  });

  it('returns empty map and skips fetch when given empty ID list', async () => {
    let called = false;
    const trackingFetch: typeof fetch = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };
    const map = await hydrateGithubItemBodies([], 'tok', trackingFetch);
    expect(map.size).toBe(0);
    expect(called).toBe(false);
  });

  it('throws on GraphQL error response', async () => {
    const canned = { errors: [{ message: 'Bad credentials' }] };
    const fakeFetch = makeFetch([canned]);
    await expect(hydrateGithubItemBodies(['I_1'], 'tok', fakeFetch)).rejects.toThrow(
      /Bad credentials/,
    );
  });

  it('skips nodes that are null or missing body', async () => {
    const canned = {
      data: {
        nodes: [null, { id: 'I_1' }, { id: 'I_2', body: 'text' }],
      },
    };
    const fakeFetch = makeFetch([canned]);
    const map = await hydrateGithubItemBodies(['I_1', 'I_2', 'I_3'], 'tok', fakeFetch);
    expect(map.size).toBe(1);
    expect(map.get('I_2')).toBe('text');
  });
});

function makeItemNode(id: string, status: string) {
  return {
    id,
    content: {
      __typename: 'Issue',
      id: `I_${id}`,
      number: 1,
      title: 't',
      url: 'https://x',
      repository: { name: 'shop', owner: { login: 'acme' } },
    },
    fieldValues: {
      nodes: [
        {
          __typename: 'ProjectV2ItemFieldSingleSelectValue',
          name: status,
          field: { __typename: 'ProjectV2SingleSelectField', name: 'Status' },
        },
      ],
    },
  };
}

function makeFetch(
  pages: unknown[],
  onCall?: (variables: Record<string, unknown>) => void,
): typeof fetch {
  let call = 0;
  return (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      variables?: Record<string, unknown>;
    };
    onCall?.(body.variables ?? {});
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return new Response(JSON.stringify(page), { status: 200 });
  }) as typeof fetch;
}
