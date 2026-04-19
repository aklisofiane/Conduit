/**
 * Minimal GitHub Projects v2 GraphQL client used by `pollBoardActivity`.
 *
 * Scope: list items in a single project along with their linked issue/PR and
 * the single-select field values we care about for filtering (Status by
 * default). We pull all pages and let the activity do the filter/diff —
 * pagination + rate-limit handling lives here.
 *
 * The query is scoped by `owner` + `project number`. GitHub resolves an org
 * or user project by those two; callers tell us which via `ownerType`.
 */

const GRAPHQL_URL = process.env.GITHUB_GRAPHQL_URL ?? 'https://api.github.com/graphql';
const PAGE_SIZE = 50;
const MAX_PAGES = 40; // 2000 items ceiling — plenty for v1, bounded by design.

export interface ProjectBoardQuery {
  ownerType: 'user' | 'org';
  owner: string;
  projectNumber: number;
  token: string;
}

export interface ProjectBoardItem {
  /** Project item node id — stable, survives title/status edits. Used as the dedup key. */
  itemNodeId: string;
  /** Linked issue/PR node id (or undefined for draft items). */
  contentNodeId?: string;
  contentType?: 'Issue' | 'PullRequest' | 'DraftIssue';
  /** Human-visible issue/PR number, `undefined` for draft items. Stringified. */
  contentKey?: string;
  contentTitle?: string;
  contentUrl?: string;
  /** Repository the content lives in (issues/PRs only). */
  repo?: { owner: string; name: string };
  /** Current single-select field values on the item, keyed by field name (e.g. `Status`). */
  singleSelectValues: Record<string, string>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; type?: string }>;
}

interface ProjectItemsResponse {
  owner?: { projectV2?: ProjectV2Payload | null } | null;
}

interface ProjectV2Payload {
  items: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<RawProjectItem | null>;
  };
}

interface RawProjectItem {
  id: string;
  content:
    | null
    | {
        __typename: 'Issue' | 'PullRequest' | 'DraftIssue';
        // Issue / PullRequest common fields
        id?: string;
        number?: number;
        title?: string;
        url?: string;
        repository?: { name: string; owner: { login: string } };
      };
  fieldValues: {
    nodes: Array<
      | null
      | {
          __typename?: string;
          name?: string;
          field?: { __typename?: string; name?: string };
        }
    >;
  };
}

function buildQuery(ownerType: 'user' | 'org'): string {
  // Query both roots is invalid — one of them returns null for any given
  // login. Pick the right root up front and alias it to `owner` so the
  // response shape is uniform regardless of ownerType.
  const root = ownerType === 'org' ? 'organization' : 'user';
  return /* GraphQL */ `
    query ConduitPollBoard(
      $login: String!
      $number: Int!
      $first: Int!
      $after: String
    ) {
      owner: ${root}(login: $login) {
        projectV2(number: $number) {
          items(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              content {
                __typename
                ... on Issue {
                  id
                  number
                  title
                  url
                  repository { name owner { login } }
                }
                ... on PullRequest {
                  id
                  number
                  title
                  url
                  repository { name owner { login } }
                }
                ... on DraftIssue {
                  id
                  title
                }
              }
              fieldValues(first: 20) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      __typename
                      ... on ProjectV2SingleSelectField { name }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}

export async function fetchProjectBoardItems(
  q: ProjectBoardQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectBoardItem[]> {
  const items: ProjectBoardItem[] = [];
  let cursor: string | null = null;

  const query = buildQuery(q.ownerType);

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload: GraphQLResponse<ProjectItemsResponse> = await callGraphQL(
      {
        query,
        variables: {
          login: q.owner,
          number: q.projectNumber,
          first: PAGE_SIZE,
          after: cursor,
        },
      },
      q.token,
      fetchImpl,
    );

    if (payload.errors?.length) {
      throw new Error(
        `GitHub GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`,
      );
    }

    const project = payload.data?.owner?.projectV2;
    if (!project) {
      throw new Error(
        `Project v2 #${q.projectNumber} not found under ${q.ownerType} "${q.owner}" (token may lack read:project scope)`,
      );
    }

    for (const raw of project.items.nodes) {
      if (!raw) continue;
      items.push(toItem(raw));
    }

    if (!project.items.pageInfo.hasNextPage) return items;
    cursor = project.items.pageInfo.endCursor;
  }

  // Ceiling hit — return what we have so callers still make progress on
  // realistic boards. The upstream docs cap v1 board size.
  return items;
}

async function callGraphQL(
  body: { query: string; variables: Record<string, unknown> },
  token: string,
  fetchImpl: typeof fetch,
): Promise<GraphQLResponse<ProjectItemsResponse>> {
  const resp = await fetchImpl(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'conduit-poll/0.1',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(
      `GitHub GraphQL HTTP ${resp.status}: ${await resp.text().catch(() => '')}`,
    );
  }
  return (await resp.json()) as GraphQLResponse<ProjectItemsResponse>;
}

function toItem(raw: RawProjectItem): ProjectBoardItem {
  const singleSelectValues: Record<string, string> = {};
  for (const fv of raw.fieldValues.nodes) {
    if (!fv) continue;
    // We only interpret single-select values (filter-friendly). Numbers,
    // dates, iterations, text — ignored for now.
    if (fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' && fv.name && fv.field?.name) {
      singleSelectValues[fv.field.name] = fv.name;
    }
  }

  const content = raw.content ?? undefined;
  const item: ProjectBoardItem = { itemNodeId: raw.id, singleSelectValues };
  if (!content) return item;

  item.contentType = content.__typename;
  if (content.id) item.contentNodeId = content.id;
  if (content.title) item.contentTitle = content.title;
  if (typeof content.number === 'number') item.contentKey = String(content.number);
  if (content.url) item.contentUrl = content.url;
  if (content.repository?.name && content.repository.owner?.login) {
    item.repo = { owner: content.repository.owner.login, name: content.repository.name };
  }
  return item;
}
