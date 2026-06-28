/**
 * GitLab project branches REST client. Mirrors `github/branches.ts` — returns
 * a plain `string[]` of branch names so the cron branch picker dispatches on
 * platform, not on shape.
 */

import { gitlabApiUrl, gitlabAuthHeaders } from './http';

const PAGE_SIZE = 100;
const MAX_PAGES = 20; // 2000 branches ceiling — matches github/branches.ts.

export interface ListGitlabProjectBranchesQuery {
  hostUrl: string;
  projectPath: string;
  token: string;
  fetchImpl?: typeof fetch;
}

interface RawGitlabBranch {
  name?: string;
}

export async function listGitlabProjectBranches(
  q: ListGitlabProjectBranchesQuery,
): Promise<string[]> {
  const f = q.fetchImpl ?? fetch;
  const base = gitlabApiUrl(q.hostUrl);
  const encoded = encodeURIComponent(q.projectPath);
  const branches: string[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${base}/projects/${encoded}/repository/branches?per_page=${PAGE_SIZE}&page=${page}`;
    const resp = await f(url, {
      method: 'GET',
      headers: gitlabAuthHeaders(q.token),
    });
    if (!resp.ok) {
      throw new Error(
        `GitLab REST HTTP ${resp.status} listing branches for ${q.projectPath}`,
      );
    }
    const batch = (await resp.json()) as RawGitlabBranch[];
    for (const raw of batch) {
      if (raw.name) branches.push(raw.name);
    }
    if (batch.length < PAGE_SIZE) return branches;
  }

  return branches;
}
