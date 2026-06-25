/**
 * Minimal repo-labels REST client. Labels are a repo-level concept, not a
 * Project v2 field, so this lives separately from `projects.ts`.
 *
 * Used at config time by `POST /workflows/:workflowId/trigger/list-labels`
 * to populate the "Allowed labels" picker on the agent panel.
 */

import { githubAuthHeaders, githubRestUrl } from './http';

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // 1000 labels ceiling — generous for any realistic repo.

export interface ListRepoLabelsQuery {
  owner: string;
  repo: string;
  token: string;
}

export interface RepoLabel {
  name: string;
  color: string;
  description: string | null;
}

interface RawLabel {
  name?: string;
  color?: string;
  description?: string | null;
}

export async function listRepoLabels(
  q: ListRepoLabelsQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoLabel[]> {
  const labels: RepoLabel[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${githubRestUrl()}/repos/${encodeURIComponent(q.owner)}/${encodeURIComponent(q.repo)}/labels?per_page=${PAGE_SIZE}&page=${page}`;
    const resp = await fetchImpl(url, {
      method: 'GET',
      headers: {
        ...githubAuthHeaders(q.token),
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!resp.ok) {
      throw new Error(
        `GitHub REST HTTP ${resp.status} listing labels for ${q.owner}/${q.repo}: ${await resp.text().catch(() => '')}`,
      );
    }
    const batch = (await resp.json()) as RawLabel[];
    for (const raw of batch) {
      if (!raw.name) continue;
      labels.push({
        name: raw.name,
        color: raw.color ?? '',
        description: raw.description ?? null,
      });
    }
    if (batch.length < PAGE_SIZE) return labels;
  }
  return labels;
}

export interface CreateRepoLabelQuery {
  owner: string;
  repo: string;
  token: string;
  /** Label name to create. */
  name: string;
  /** 6-digit hex without a leading `#`. */
  color: string;
  description?: string;
}

/**
 * Idempotent create: `POST /repos/{owner}/{repo}/labels`. GitHub returns
 * `422` with an `already_exists` error code when the label is already present —
 * we treat that as success (ensure semantics; never overwrites the existing
 * label's color/description). Any other non-2xx throws with the same
 * error-string style as `listRepoLabels`.
 */
export async function createRepoLabel(
  q: CreateRepoLabelQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<'created' | 'exists'> {
  const url = `${githubRestUrl()}/repos/${encodeURIComponent(q.owner)}/${encodeURIComponent(q.repo)}/labels`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      ...githubAuthHeaders(q.token),
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: q.name,
      color: q.color,
      description: q.description ?? '',
    }),
  });
  if (resp.ok) return 'created';

  const text = await resp.text().catch(() => '');
  if (resp.status === 422 && text.includes('already_exists')) return 'exists';
  throw new Error(
    `GitHub REST HTTP ${resp.status} creating label "${q.name}" for ${q.owner}/${q.repo}: ${text}`,
  );
}
