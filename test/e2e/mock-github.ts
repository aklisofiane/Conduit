import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Tiny stand-in for GitHub's GraphQL API used by Phase 4 polling tests.
 * Rotates through a queue of canned responses so the test can script "cycle
 * 1 shows A+B, cycle 2 shows A+B, cycle 3 shows A+C" without timing games.
 *
 * Response shape must match what `fetchProjectBoardItems` expects:
 *   { data: { owner: { projectV2: { items: { pageInfo, nodes: [...] } } } } }
 */
export interface MockGithubGraphql {
  url: string;
  /** Queue the body returned on the next POST. Later queues win across calls. */
  enqueue(body: unknown): void;
  /** Requests seen so far, useful for asserting the poll ran. */
  requestCount(): number;
  close(): Promise<void>;
}

export async function startMockGithubGraphql(): Promise<MockGithubGraphql> {
  const responses: unknown[] = [];
  let count = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      count += 1;
      // Always return the most-recently enqueued response — lets the test
      // "replace" the board state between cycles without worrying about
      // consumption order. If nothing queued, return an empty items array
      // so the poll doesn't crash on startup races.
      const body = responses.length > 0 ? responses[responses.length - 1] : emptyResponse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}/graphql`;

  return {
    url,
    enqueue: (body) => {
      responses.push(body);
    },
    requestCount: () => count,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export interface MockBoardItem {
  itemId: string;
  /** Human issue number. */
  number?: number;
  title?: string;
  status: string;
  labels?: string[];
  /**
   * Set to `'pull_request'` to return a PullRequest content node instead of an
   * Issue. PR-only fields (`isDraft`, `headRefName`, `baseRefName`) are read
   * from this object too.
   */
  contentType?: 'issue' | 'pull_request';
  isDraft?: boolean;
  headRefName?: string;
  baseRefName?: string;
}

export function projectBoardResponse(items: MockBoardItem[]): unknown {
  return {
    data: {
      owner: {
        projectV2: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: items.map((it) => {
              const number = it.number ?? 1;
              const title = it.title ?? `Item ${it.itemId}`;
              const repository = { name: 'shop', owner: { login: 'acme' } };
              const labels = {
                nodes: (it.labels ?? []).map((name) => ({ name })),
              };
              const fieldValues = {
                nodes: [
                  {
                    __typename: 'ProjectV2ItemFieldSingleSelectValue',
                    name: it.status,
                    field: { __typename: 'ProjectV2SingleSelectField', name: 'Status' },
                  },
                ],
              };
              if (it.contentType === 'pull_request') {
                return {
                  id: it.itemId,
                  content: {
                    __typename: 'PullRequest',
                    id: `PR_${it.itemId}`,
                    number,
                    title,
                    url: `https://github.com/acme/shop/pull/${number}`,
                    repository,
                    labels,
                    isDraft: it.isDraft ?? false,
                    headRefName: it.headRefName ?? `feature-${number}`,
                    baseRefName: it.baseRefName ?? 'main',
                    headRepository: repository,
                  },
                  fieldValues,
                };
              }
              return {
                id: it.itemId,
                content: {
                  __typename: 'Issue',
                  id: `I_${it.itemId}`,
                  number,
                  title,
                  url: `https://github.com/acme/shop/issues/${number}`,
                  repository,
                  labels,
                },
                fieldValues,
              };
            }),
          },
        },
      },
    },
  };
}

function emptyResponse(): unknown {
  return {
    data: {
      owner: {
        projectV2: {
          items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
        },
      },
    },
  };
}
