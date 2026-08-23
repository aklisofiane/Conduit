/**
 * Minimal repo-branches REST client. Branches are a repo-level concept, not a
 * Project v2 field, so this lives alongside `labels.ts` rather than in
 * `projects.ts`.
 *
 * Used at config time by `POST /trigger/list-branches` to populate the cron
 * trigger's branch picker, so the anchored branch can't be a typo by
 * construction.
 */

import { githubAuthHeaders, githubRestUrl } from './http';

const PAGE_SIZE = 100;
const MAX_PAGES = 20; // 2000 branches ceiling — generous for any realistic repo.

export interface ListRepoBranchesQuery {
  owner: string;
  repo: string;
  token: string;
}

interface RawBranch {
  name?: string;
}

export async function listRepoBranches(
  q: ListRepoBranchesQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const branches: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${githubRestUrl()}/repos/${encodeURIComponent(q.owner)}/${encodeURIComponent(q.repo)}/branches?per_page=${PAGE_SIZE}&page=${page}`;
    const resp = await fetchImpl(url, {
      method: 'GET',
      headers: {
        ...githubAuthHeaders(q.token),
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!resp.ok) {
      throw new Error(`GitHub REST HTTP ${resp.status} listing branches for ${q.owner}/${q.repo}`);
    }
    const batch = (await resp.json()) as RawBranch[];
    for (const raw of batch) {
      if (raw.name) branches.push(raw.name);
    }
    if (batch.length < PAGE_SIZE) return branches;
  }
  return branches;
}
