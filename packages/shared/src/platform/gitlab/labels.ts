/**
 * GitLab project labels REST client. Mirrors `github/labels.ts` — returns
 * the same `RepoLabel` shape so consumers dispatch on platform, not on
 * label type.
 */

import type { RepoLabel } from '../github/labels';
import { gitlabApiUrl, gitlabAuthHeaders } from './http';

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // 1000 labels ceiling — matches github/labels.ts.

export interface ListGitlabProjectLabelsQuery {
  hostUrl: string;
  projectPath: string;
  token: string;
  fetchImpl?: typeof fetch;
}

interface RawGitlabLabel {
  name?: string;
  color?: string;
  description?: string | null;
}

export async function listGitlabProjectLabels(
  q: ListGitlabProjectLabelsQuery,
): Promise<RepoLabel[]> {
  const f = q.fetchImpl ?? fetch;
  const base = gitlabApiUrl(q.hostUrl);
  const encoded = encodeURIComponent(q.projectPath);
  const labels: RepoLabel[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${base}/projects/${encoded}/labels?per_page=${PAGE_SIZE}&page=${page}`;
    const resp = await f(url, {
      method: 'GET',
      headers: gitlabAuthHeaders(q.token),
    });
    if (!resp.ok) {
      throw new Error(
        `GitLab REST HTTP ${resp.status} listing labels for ${q.projectPath}: ${await resp.text().catch(() => '')}`,
      );
    }
    const batch = (await resp.json()) as RawGitlabLabel[];
    for (const raw of batch) {
      if (!raw.name) continue;
      labels.push({
        name: raw.name,
        color: (raw.color ?? '').replace(/^#/, ''),
        description: raw.description ?? null,
      });
    }
    if (batch.length < PAGE_SIZE) return labels;
  }

  return labels;
}

export interface CreateGitlabProjectLabelQuery {
  hostUrl: string;
  projectPath: string;
  token: string;
  /** Label name to create. */
  name: string;
  /** 6-digit hex without a leading `#` — GitLab requires `#`, which we add. */
  color: string;
  description?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Idempotent create: `POST /projects/{id}/labels`. GitLab requires a hex
 * `color` (we prepend `#`) and returns `409` when the label already exists —
 * treated as success (ensure semantics; never overwrites). Any other non-2xx
 * throws with the same error-string style as `listGitlabProjectLabels`.
 */
export async function createGitlabProjectLabel(
  q: CreateGitlabProjectLabelQuery,
): Promise<'created' | 'exists'> {
  const f = q.fetchImpl ?? fetch;
  const base = gitlabApiUrl(q.hostUrl);
  const encoded = encodeURIComponent(q.projectPath);
  const url = `${base}/projects/${encoded}/labels`;

  const resp = await f(url, {
    method: 'POST',
    headers: {
      ...gitlabAuthHeaders(q.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: q.name,
      color: `#${q.color.replace(/^#/, '')}`,
      description: q.description ?? '',
    }),
  });
  if (resp.ok) return 'created';
  if (resp.status === 409) return 'exists';
  throw new Error(
    `GitLab REST HTTP ${resp.status} creating label "${q.name}" for ${q.projectPath}: ${await resp.text().catch(() => '')}`,
  );
}
