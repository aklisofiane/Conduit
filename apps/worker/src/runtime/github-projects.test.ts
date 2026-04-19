import { describe, expect, it } from 'vitest';
import { fetchProjectBoardItems } from './github-projects';

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
