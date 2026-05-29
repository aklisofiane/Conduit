/**
 * GitLab project issues + merge requests REST client. Mirrors the shape of
 * `github/projects.ts` — both return `ProjectBoardItem[]` so the downstream
 * polling pipeline (filter, dedup, event-build) works unchanged.
 *
 * Hand-rolled REST against `/api/v4`; no `@gitbeaker` dependency.
 */

import type { ProjectBoardItem } from '../github/projects';
import { gitlabApiUrl, gitlabAuthHeaders } from './http';

const PAGE_SIZE = 100;
const MAX_PAGES = 40; // 4000 items ceiling — matches github/projects.ts.

export interface GitlabProjectQuery {
  hostUrl: string;
  projectPath: string;
  token: string;
  fetchImpl?: typeof fetch;
}

// ── Issues ──────────────────────────────────────────────────────────────

interface RawGitlabIssue {
  id: number;
  iid: number;
  title: string;
  description?: string | null;
  web_url: string;
  labels: string[];
}

export async function fetchGitlabProjectIssues(
  q: GitlabProjectQuery,
): Promise<ProjectBoardItem[]> {
  const f = q.fetchImpl ?? fetch;
  const base = gitlabApiUrl(q.hostUrl);
  const encoded = encodeURIComponent(q.projectPath);
  const items: ProjectBoardItem[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${base}/projects/${encoded}/issues?state=opened&per_page=${PAGE_SIZE}&order_by=updated_at&page=${page}`;
    const resp = await f(url, {
      method: 'GET',
      headers: gitlabAuthHeaders(q.token),
    });
    if (!resp.ok) {
      throw new Error(
        `GitLab REST HTTP ${resp.status}: ${await resp.text().catch(() => '')}`,
      );
    }
    const batch = (await resp.json()) as RawGitlabIssue[];
    const { owner, name } = splitProjectPath(q.projectPath);
    for (const raw of batch) {
      const item: ProjectBoardItem = {
        itemNodeId: String(raw.id),
        contentNodeId: String(raw.id),
        contentType: 'Issue',
        contentKey: String(raw.iid),
        contentTitle: raw.title,
        contentUrl: raw.web_url,
        repo: { owner, name },
        singleSelectValues: {},
        labels: raw.labels ?? [],
      };
      if (typeof raw.description === 'string') item.contentBody = raw.description;
      items.push(item);
    }
    if (batch.length < PAGE_SIZE) return items;
  }

  return items;
}

// ── Merge Requests ──────────────────────────────────────────────────────

interface RawGitlabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description?: string | null;
  web_url: string;
  labels: string[];
  source_branch: string;
  target_branch: string;
  draft: boolean;
}

export async function fetchGitlabProjectMergeRequests(
  q: GitlabProjectQuery,
): Promise<ProjectBoardItem[]> {
  const f = q.fetchImpl ?? fetch;
  const base = gitlabApiUrl(q.hostUrl);
  const encoded = encodeURIComponent(q.projectPath);
  const items: ProjectBoardItem[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${base}/projects/${encoded}/merge_requests?state=opened&per_page=${PAGE_SIZE}&order_by=updated_at&page=${page}`;
    const resp = await f(url, {
      method: 'GET',
      headers: gitlabAuthHeaders(q.token),
    });
    if (!resp.ok) {
      throw new Error(
        `GitLab REST HTTP ${resp.status}: ${await resp.text().catch(() => '')}`,
      );
    }
    const batch = (await resp.json()) as RawGitlabMergeRequest[];
    const { owner, name } = splitProjectPath(q.projectPath);
    for (const raw of batch) {
      const item: ProjectBoardItem = {
        itemNodeId: String(raw.id),
        contentNodeId: String(raw.id),
        contentType: 'PullRequest',
        contentKey: String(raw.iid),
        contentTitle: raw.title,
        contentUrl: raw.web_url,
        repo: { owner, name },
        singleSelectValues: {},
        labels: raw.labels ?? [],
        pr: {
          headRef: raw.source_branch,
          baseRef: raw.target_branch,
          state: raw.draft ? 'draft' : 'ready_for_review',
        },
      };
      if (typeof raw.description === 'string') item.contentBody = raw.description;
      items.push(item);
    }
    if (batch.length < PAGE_SIZE) return items;
  }

  return items;
}

// ── Project listing (membership-based, no owner input needed) ──────────

export interface GitlabProjectSummary {
  path: string;
  url: string;
}

interface RawGitlabProject {
  path_with_namespace: string;
  web_url: string;
}

export async function listAccessibleGitlabProjects(
  q: { hostUrl: string; token: string; fetchImpl?: typeof fetch },
): Promise<GitlabProjectSummary[]> {
  const f = q.fetchImpl ?? fetch;
  const base = gitlabApiUrl(q.hostUrl);
  const items: GitlabProjectSummary[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${base}/projects?membership=true&per_page=${PAGE_SIZE}&order_by=name&sort=asc&page=${page}`;
    const resp = await f(url, {
      method: 'GET',
      headers: gitlabAuthHeaders(q.token),
    });
    if (!resp.ok) {
      throw new Error(
        `GitLab REST HTTP ${resp.status}: ${await resp.text().catch(() => '')}`,
      );
    }
    const batch = (await resp.json()) as RawGitlabProject[];
    for (const raw of batch) {
      items.push({ path: raw.path_with_namespace, url: raw.web_url });
    }
    if (batch.length < PAGE_SIZE) return items;
  }

  return items;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Split a GitLab project path into `{ owner, name }`. For subgroup paths
 * like `group/subgroup/api`, the last segment is `name` and the rest is
 * joined back as `owner` — mirrors the two-part `{ owner, name }` shape
 * used by `ProjectBoardItem.repo`.
 */
export function splitProjectPath(projectPath: string): { owner: string; name: string } {
  const parts = projectPath.split('/');
  if (parts.length < 2) return { owner: '', name: projectPath };
  return {
    owner: parts.slice(0, -1).join('/'),
    name: parts[parts.length - 1]!,
  };
}
