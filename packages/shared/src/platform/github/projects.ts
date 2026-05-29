/**
 * Minimal GitHub Projects v2 GraphQL client. GitHub resolves a project's
 * `owner` via either the `organization` or `user` root — callers tell us
 * which via `ownerType`, since a single GraphQL query against both roots
 * isn't valid (the wrong one returns null).
 */

import { githubAuthHeaders, githubGraphqlUrl } from './http';

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
  /**
   * Issue/PR body markdown at fetch time. Populated only for `Issue` and
   * `PullRequest` content; absent for draft items and any older callers that
   * don't request it. Forwarded by `toTriggerEvent` as `event.issue.body`.
   */
  contentBody?: string;
  /** Repository the content lives in (issues/PRs only). */
  repo?: { owner: string; name: string };
  /** Current single-select field values on the item, keyed by field name (e.g. `Status`). */
  singleSelectValues: Record<string, string>;
  /** Issue/PR label names. Empty for draft items or content with no labels. */
  labels: string[];
  /**
   * PR-specific fields. Populated only when `contentType === 'PullRequest'`
   * and the GraphQL response carried head/base ref names. Polling-of-PRs
   * needs this to land on the PR's branch and to drive the `pr_state` filter.
   */
  pr?: {
    headRef: string;
    baseRef: string;
    headRepo?: { owner: string; name: string };
    state: 'draft' | 'ready_for_review';
  };
}

export interface ListProjectBoardsQuery {
  ownerType: 'user' | 'org';
  owner: string;
  token: string;
}

export interface ProjectBoardSummary {
  number: number;
  title: string;
  url: string;
  /** Single-select fields only — other field types are filtered out by the GraphQL fragment. */
  fields: Array<{ name: string; options: string[] }>;
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

interface ProjectListResponse {
  owner?: {
    projectsV2?: {
      nodes: Array<RawProjectSummary | null>;
    } | null;
  } | null;
}

interface RawProjectSummary {
  number: number;
  title: string;
  url: string;
  fields: {
    nodes: Array<null | {
      __typename?: string;
      name?: string;
      options?: Array<{ name: string }>;
    }>;
  };
}

interface RawProjectItem {
  id: string;
  content: null | {
    __typename: 'Issue' | 'PullRequest' | 'DraftIssue';
    // Issue / PullRequest common fields
    id?: string;
    number?: number;
    title?: string;
    url?: string;
    body?: string;
    repository?: { name: string; owner: { login: string } };
    labels?: { nodes: Array<{ name?: string } | null> };
    // PullRequest-only fields
    isDraft?: boolean;
    headRefName?: string;
    baseRefName?: string;
    headRepository?: { name: string; owner: { login: string } } | null;
  };
  fieldValues: {
    nodes: Array<null | {
      __typename?: string;
      name?: string;
      field?: { __typename?: string; name?: string };
    }>;
  };
}

function buildItemsQuery(ownerType: 'user' | 'org'): string {
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
                  labels(first: 20) { nodes { name } }
                }
                ... on PullRequest {
                  id
                  number
                  title
                  url
                  repository { name owner { login } }
                  labels(first: 20) { nodes { name } }
                  isDraft
                  headRefName
                  baseRefName
                  headRepository { name owner { login } }
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

function buildListProjectsQuery(ownerType: 'user' | 'org'): string {
  const root = ownerType === 'org' ? 'organization' : 'user';
  return /* GraphQL */ `
    query ConduitListProjects($login: String!, $first: Int!) {
      owner: ${root}(login: $login) {
        projectsV2(first: $first) {
          nodes {
            number
            title
            url
            fields(first: 50) {
              nodes {
                __typename
                ... on ProjectV2SingleSelectField {
                  name
                  options { name }
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

  const query = buildItemsQuery(q.ownerType);

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
      throw new Error(`GitHub GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
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

export async function listProjectBoards(
  q: ListProjectBoardsQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectBoardSummary[]> {
  const payload: GraphQLResponse<ProjectListResponse> = await callGraphQL(
    {
      query: buildListProjectsQuery(q.ownerType),
      variables: { login: q.owner, first: 50 },
    },
    q.token,
    fetchImpl,
  );

  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
  }

  const owner = payload.data?.owner;
  if (!owner) {
    throw new Error(
      `${q.ownerType === 'org' ? 'Organization' : 'User'} "${q.owner}" not found (or token lacks access)`,
    );
  }
  const projects = owner.projectsV2?.nodes ?? [];

  const summaries: ProjectBoardSummary[] = [];
  for (const project of projects) {
    if (!project) continue;
    const fields: ProjectBoardSummary['fields'] = [];
    for (const node of project.fields.nodes) {
      if (!node) continue;
      if (node.__typename !== 'ProjectV2SingleSelectField') continue;
      if (!node.name) continue;
      const options = (node.options ?? []).map((o) => o.name).filter(Boolean);
      fields.push({ name: node.name, options });
    }
    summaries.push({
      number: project.number,
      title: project.title,
      url: project.url,
      fields,
    });
  }

  return summaries;
}

async function callGraphQL<T>(
  body: { query: string; variables: Record<string, unknown> },
  token: string,
  fetchImpl: typeof fetch,
): Promise<GraphQLResponse<T>> {
  const resp = await fetchImpl(githubGraphqlUrl(), {
    method: 'POST',
    headers: {
      ...githubAuthHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`GitHub GraphQL HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
  }
  return (await resp.json()) as GraphQLResponse<T>;
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
  const item: ProjectBoardItem = { itemNodeId: raw.id, singleSelectValues, labels: [] };
  if (!content) return item;

  item.contentType = content.__typename;
  if (content.id) item.contentNodeId = content.id;
  if (content.title) item.contentTitle = content.title;
  if (typeof content.number === 'number') item.contentKey = String(content.number);
  if (content.url) item.contentUrl = content.url;
  if (typeof content.body === 'string') item.contentBody = content.body;
  if (content.repository?.name && content.repository.owner?.login) {
    item.repo = { owner: content.repository.owner.login, name: content.repository.name };
  }
  if (content.labels?.nodes) {
    for (const node of content.labels.nodes) {
      if (node?.name) item.labels.push(node.name);
    }
  }
  if (
    content.__typename === 'PullRequest' &&
    typeof content.headRefName === 'string' &&
    typeof content.baseRefName === 'string'
  ) {
    const pr: NonNullable<ProjectBoardItem['pr']> = {
      headRef: content.headRefName,
      baseRef: content.baseRefName,
      state: content.isDraft ? 'draft' : 'ready_for_review',
    };
    const fork = forkHeadRepo(content.repository, content.headRepository);
    if (fork) pr.headRepo = fork;
    item.pr = pr;
  }
  return item;
}

/**
 * Match the webhook-side `extractPr` semantic: only surface `headRepo` when
 * the head lives in a different repo than the base (fork PR), so consumers
 * can treat presence as the fork signal.
 */
function forkHeadRepo(
  base: { name: string; owner: { login: string } } | undefined,
  head: { name: string; owner: { login: string } } | null | undefined,
): { owner: string; name: string } | undefined {
  const headOwner = head?.owner?.login;
  const headName = head?.name;
  if (!headOwner || !headName) return undefined;
  if (headOwner === base?.owner?.login && headName === base?.name) return undefined;
  return { owner: headOwner, name: headName };
}

// ── Repository listing (viewer-scoped) ─────────────────────────────────

export interface RepositorySummary {
  owner: string;
  name: string;
  url: string;
  isPrivate: boolean;
}

const VIEWER_REPOS_QUERY = /* GraphQL */ `
  query ConduitViewerRepos($first: Int!) {
    viewer {
      repositories(first: $first, orderBy: { field: NAME, direction: ASC }) {
        nodes {
          name
          url
          isPrivate
          owner {
            login
          }
        }
      }
    }
  }
`;

interface ViewerReposResponse {
  viewer?: {
    repositories?: {
      nodes: Array<{
        name: string;
        url: string;
        isPrivate: boolean;
        owner: { login: string };
      } | null>;
    } | null;
  } | null;
}

export async function listViewerRepositories(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepositorySummary[]> {
  const payload: GraphQLResponse<ViewerReposResponse> = await callGraphQL(
    { query: VIEWER_REPOS_QUERY, variables: { first: 100 } },
    token,
    fetchImpl,
  );

  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
  }

  const repos: RepositorySummary[] = [];
  for (const node of payload.data?.viewer?.repositories?.nodes ?? []) {
    if (!node) continue;
    repos.push({
      owner: node.owner.login,
      name: node.name,
      url: node.url,
      isPrivate: node.isPrivate,
    });
  }
  return repos;
}

// ── Viewer organizations (for board owner picker) ──────────────────────

export interface ViewerOrgEntry {
  login: string;
  ownerType: 'user' | 'org';
}

const VIEWER_ORGS_QUERY = /* GraphQL */ `
  query ConduitViewerOrgs {
    viewer {
      login
      organizations(first: 100) {
        nodes {
          login
        }
      }
    }
  }
`;

interface ViewerOrgsResponse {
  viewer?: {
    login?: string;
    organizations?: {
      nodes: Array<{ login: string } | null>;
    } | null;
  } | null;
}

export async function listViewerOrganizations(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ViewerOrgEntry[]> {
  const payload: GraphQLResponse<ViewerOrgsResponse> = await callGraphQL(
    { query: VIEWER_ORGS_QUERY, variables: {} },
    token,
    fetchImpl,
  );

  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
  }

  const viewer = payload.data?.viewer;
  const entries: ViewerOrgEntry[] = [];

  if (viewer?.login) {
    entries.push({ login: viewer.login, ownerType: 'user' });
  }
  for (const node of viewer?.organizations?.nodes ?? []) {
    if (!node) continue;
    entries.push({ login: node.login, ownerType: 'org' });
  }
  return entries;
}

// ── Repository content fetching ────────────────────────────────────────

export interface RepoQuery {
  owner: string;
  name: string;
  token: string;
}

interface RawRepoPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  body?: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  repository: { name: string; owner: { login: string } };
  headRepository?: { name: string; owner: { login: string } } | null;
  labels?: { nodes: Array<{ name?: string } | null> };
}

interface RawRepoIssue {
  id: string;
  number: number;
  title: string;
  url: string;
  body?: string;
  repository: { name: string; owner: { login: string } };
  labels?: { nodes: Array<{ name?: string } | null> };
}

interface RepoConnectionPage<N> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: Array<N | null>;
}

const REPO_PULL_REQUESTS_QUERY = /* GraphQL */ `
  query ConduitRepoPullRequests($owner: String!, $name: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(
        first: $first
        after: $after
        states: [OPEN]
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          number
          title
          url
          isDraft
          headRefName
          baseRefName
          repository {
            name
            owner {
              login
            }
          }
          headRepository {
            name
            owner {
              login
            }
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
        }
      }
    }
  }
`;

const REPO_ISSUES_QUERY = /* GraphQL */ `
  query ConduitRepoIssues($owner: String!, $name: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      issues(
        first: $first
        after: $after
        states: [OPEN]
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          number
          title
          url
          repository {
            name
            owner {
              login
            }
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch open pull requests in a repository, returning the same
 * `ProjectBoardItem` shape `fetchProjectBoardItems` produces. Lets the
 * polling activity reuse the existing matcher / event-builder pipeline:
 * `itemNodeId` is the PR's own node id (stable, dedup-safe), `contentType`
 * is always `'PullRequest'`, `singleSelectValues` is empty (no board, no
 * Status column), and `pr` carries head/base refs + draft state.
 */
export function fetchRepositoryPullRequests(
  q: RepoQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectBoardItem[]> {
  return paginateRepoConnection<
    { pullRequests: RepoConnectionPage<RawRepoPullRequest> },
    RawRepoPullRequest
  >(q, REPO_PULL_REQUESTS_QUERY, (repo) => repo.pullRequests, repoPullRequestToItem, fetchImpl);
}

/**
 * Fetch open issues in a repository, returning the same `ProjectBoardItem`
 * shape `fetchProjectBoardItems` produces. Mirror of
 * `fetchRepositoryPullRequests` for issue scope; `singleSelectValues` is
 * empty (no board, no Status column) and `pr` is undefined.
 */
export function fetchRepositoryIssues(
  q: RepoQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectBoardItem[]> {
  return paginateRepoConnection<{ issues: RepoConnectionPage<RawRepoIssue> }, RawRepoIssue>(
    q,
    REPO_ISSUES_QUERY,
    (repo) => repo.issues,
    repoIssueToItem,
    fetchImpl,
  );
}

async function paginateRepoConnection<R, N>(
  q: RepoQuery,
  query: string,
  selectPage: (repo: R) => RepoConnectionPage<N>,
  toItem: (raw: N) => ProjectBoardItem,
  fetchImpl: typeof fetch,
): Promise<ProjectBoardItem[]> {
  const items: ProjectBoardItem[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload: GraphQLResponse<{ repository?: R | null }> = await callGraphQL(
      {
        query,
        variables: { owner: q.owner, name: q.name, first: PAGE_SIZE, after: cursor },
      },
      q.token,
      fetchImpl,
    );

    if (payload.errors?.length) {
      throw new Error(`GitHub GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
    }

    const repo = payload.data?.repository;
    if (!repo) {
      throw new Error(`Repository ${q.owner}/${q.name} not found (token may lack repo scope)`);
    }

    const conn = selectPage(repo);
    for (const raw of conn.nodes) {
      if (!raw) continue;
      items.push(toItem(raw));
    }
    if (!conn.pageInfo.hasNextPage) return items;
    cursor = conn.pageInfo.endCursor;
  }

  return items;
}

function repoPullRequestToItem(raw: RawRepoPullRequest): ProjectBoardItem {
  const item: ProjectBoardItem = {
    // No project item wraps a repo-source PR — use the PR node id as the
    // dedup key. Stable across draft↔ready transitions.
    itemNodeId: raw.id,
    contentNodeId: raw.id,
    contentType: 'PullRequest',
    contentKey: String(raw.number),
    contentTitle: raw.title,
    contentUrl: raw.url,
    repo: { owner: raw.repository.owner.login, name: raw.repository.name },
    singleSelectValues: {},
    labels: [],
    pr: {
      headRef: raw.headRefName,
      baseRef: raw.baseRefName,
      state: raw.isDraft ? 'draft' : 'ready_for_review',
    },
  };
  if (typeof raw.body === 'string') item.contentBody = raw.body;
  for (const node of raw.labels?.nodes ?? []) {
    if (node?.name) item.labels.push(node.name);
  }
  const fork = forkHeadRepo(raw.repository, raw.headRepository);
  if (fork) item.pr!.headRepo = fork;
  return item;
}

function repoIssueToItem(raw: RawRepoIssue): ProjectBoardItem {
  const item: ProjectBoardItem = {
    itemNodeId: raw.id,
    contentNodeId: raw.id,
    contentType: 'Issue',
    contentKey: String(raw.number),
    contentTitle: raw.title,
    contentUrl: raw.url,
    repo: { owner: raw.repository.owner.login, name: raw.repository.name },
    singleSelectValues: {},
    labels: [],
  };
  if (typeof raw.body === 'string') item.contentBody = raw.body;
  for (const node of raw.labels?.nodes ?? []) {
    if (node?.name) item.labels.push(node.name);
  }
  return item;
}

// ── Body hydration (deferred fetch) ───────────────────────────────────

const HYDRATE_BODIES_QUERY = /* GraphQL */ `
  query ConduitHydrateBodies($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Issue {
        id
        body
      }
      ... on PullRequest {
        id
        body
      }
    }
  }
`;

interface HydrateNodesResponse {
  nodes?: Array<{ id?: string; body?: string } | null>;
}

export async function hydrateGithubItemBodies(
  nodeIds: string[],
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const bodies = new Map<string, string>();
  if (nodeIds.length === 0) return bodies;

  const payload: GraphQLResponse<HydrateNodesResponse> = await callGraphQL(
    { query: HYDRATE_BODIES_QUERY, variables: { ids: nodeIds } },
    token,
    fetchImpl,
  );

  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
  }

  for (const node of payload.data?.nodes ?? []) {
    if (node?.id && typeof node.body === 'string') {
      bodies.set(node.id, node.body);
    }
  }
  return bodies;
}
