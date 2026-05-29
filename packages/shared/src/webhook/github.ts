import type { TriggerEvent } from '../trigger/event';

/**
 * Normalize a GitHub webhook delivery into our cross-platform `TriggerEvent`.
 * Returns `null` for event types we don't route (push, release, etc.) so the
 * webhook endpoint can short-circuit with 202.
 *
 * v1 handles four events — the ones that surface an actionable issue/PR or
 * the board state change that drives board-loop workflows:
 *
 *   - `issues` (action: `opened`)                            → `event = 'issues.opened'`
 *   - `pull_request` (action: `opened`)                      → `event = 'pull_request.opened'`
 *   - `issue_comment` (action: `created`, on PR)             → `event = 'issue_comment.created'`
 *   - `projects_v2_item` (action: `edited`, Status changed)  → `event = 'board.column.changed'`
 *
 * Other actions on those same event types (edited, closed, labeled…) are
 * intentionally dropped for now; wire them in when a workflow needs them.
 */
export function normalizeGithubWebhook(
  eventName: string,
  payload: unknown,
): TriggerEvent | null {
  const p = payload as GithubWebhookPayload | null | undefined;
  if (!p || typeof p !== 'object') return null;

  const action = typeof p.action === 'string' ? p.action : undefined;
  const repo = extractRepo(p.repository);
  const actor = p.sender?.login;

  if (eventName === 'issues' && action === 'opened' && p.issue) {
    return {
      source: 'github',
      mode: 'webhook',
      event: 'issues.opened',
      payload: p as Record<string, unknown>,
      repo,
      issue: {
        id: String(p.issue.node_id ?? p.issue.id ?? ''),
        key: String(p.issue.number ?? ''),
        title: String(p.issue.title ?? ''),
        url: String(p.issue.html_url ?? ''),
        ...(typeof p.issue.body === 'string' ? { body: p.issue.body } : {}),
      },
      actor,
    };
  }

  if (eventName === 'pull_request' && action === 'opened' && p.pull_request) {
    return {
      source: 'github',
      mode: 'webhook',
      event: 'pull_request.opened',
      payload: p as Record<string, unknown>,
      repo,
      issue: {
        id: String(p.pull_request.node_id ?? p.pull_request.id ?? ''),
        key: String(p.pull_request.number ?? ''),
        title: String(p.pull_request.title ?? ''),
        url: String(p.pull_request.html_url ?? ''),
        ...(typeof p.pull_request.body === 'string' ? { body: p.pull_request.body } : {}),
      },
      pr: extractPr(p.pull_request),
      actor,
    };
  }

  // `issue_comment` fires for both issue and PR comments — gate on presence
  // of `pull_request` to scope to PR comments (Critic workflows).
  if (eventName === 'issue_comment' && action === 'created' && p.issue?.pull_request) {
    // The `issue_comment` payload's top-level `pull_request` field is absent
    // (only `issue.pull_request` exists, and it's a thin reference to the PR
    // API URL — no head/base refs). PR-comment workflows that need the head
    // ref must rely on the worktree already being on the PR branch (set up
    // by an earlier `pull_request.opened` run on the same ticket-branch row).
    // Leaving `pr` undefined here keeps the existing behavior intact.
    // `issue.body` on this payload carries the PR description (GitHub reuses
    // the `issue` object for PR-scoped comments) — forward it when present.
    return {
      source: 'github',
      mode: 'webhook',
      event: 'issue_comment.created',
      payload: p as Record<string, unknown>,
      repo,
      issue: {
        id: String(p.issue.node_id ?? p.issue.id ?? ''),
        key: String(p.issue.number ?? ''),
        title: String(p.issue.title ?? ''),
        url: String(p.issue.html_url ?? ''),
        ...(typeof p.issue.body === 'string' ? { body: p.issue.body } : {}),
      },
      actor,
    };
  }

  // Projects v2 column move. Fires only when a single-select field (any —
  // typically the "Status" field) changes value on a board item. Drop other
  // field types and actions so the rest of the pipeline only sees column
  // transitions. The payload carries the item's `content_node_id` but not the
  // human-readable issue number, so `issue` is intentionally omitted —
  // downstream agents resolve the full issue via GitHub MCP if they need it.
  // `ticket-branch` workflows therefore cannot use this webhook (save-time
  // validator rejects the combo); polling mode, which fetches full issue
  // details from the GraphQL API, is the recommended mode for board loops.
  if (eventName === 'projects_v2_item' && action === 'edited') {
    const fv = p.changes?.field_value;
    if (fv?.field_type === 'single_select' && typeof fv.to?.name === 'string') {
      return {
        source: 'github',
        mode: 'webhook',
        event: 'board.column.changed',
        payload: p as Record<string, unknown>,
        actor,
      };
    }
  }

  return null;
}

interface GithubWebhookPayload {
  action?: string;
  repository?: { owner?: { login?: string }; name?: string };
  sender?: { login?: string };
  issue?: {
    id?: number | string;
    node_id?: string;
    number?: number;
    title?: string;
    html_url?: string;
    body?: string;
    pull_request?: unknown;
  };
  pull_request?: {
    id?: number | string;
    node_id?: string;
    number?: number;
    title?: string;
    html_url?: string;
    body?: string;
    head?: {
      ref?: string;
      repo?: {
        name?: string;
        owner?: { login?: string };
      } | null;
    };
    base?: {
      ref?: string;
      repo?: {
        name?: string;
        owner?: { login?: string };
      } | null;
    };
  };
  changes?: {
    field_value?: {
      field_name?: string;
      field_type?: string;
      project_number?: number;
      from?: { name?: string };
      to?: { name?: string };
    };
  };
  projects_v2_item?: {
    id?: number | string;
    node_id?: string;
    content_node_id?: string;
    content_type?: string;
    project_node_id?: string;
  };
  organization?: { login?: string };
}

function extractRepo(
  r: GithubWebhookPayload['repository'],
): TriggerEvent['repo'] {
  if (!r?.owner?.login || !r.name) return undefined;
  return { owner: r.owner.login, name: r.name };
}

/**
 * Pull head/base refs out of a `pull_request` payload. `headRepo` is only
 * surfaced when the head lives in a different repo (fork PR) — same-repo PRs
 * leave it undefined so consumers can treat presence as the fork signal.
 */
function extractPr(
  pr: NonNullable<GithubWebhookPayload['pull_request']>,
): TriggerEvent['pr'] {
  const headRef = pr.head?.ref;
  const baseRef = pr.base?.ref;
  if (!headRef || !baseRef) return undefined;
  const headRepoOwner = pr.head?.repo?.owner?.login;
  const headRepoName = pr.head?.repo?.name;
  const baseRepoOwner = pr.base?.repo?.owner?.login;
  const baseRepoName = pr.base?.repo?.name;
  const isFork =
    !!headRepoOwner &&
    !!headRepoName &&
    !!baseRepoOwner &&
    !!baseRepoName &&
    (headRepoOwner !== baseRepoOwner || headRepoName !== baseRepoName);
  return {
    headRef,
    baseRef,
    ...(isFork ? { headRepo: { owner: headRepoOwner!, name: headRepoName! } } : {}),
  };
}
