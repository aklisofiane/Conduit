import type { TriggerEvent } from '../trigger/event';

/**
 * Normalize a GitHub webhook delivery into our cross-platform `TriggerEvent`.
 * Returns `null` for event types we don't route (push, release, etc.) so the
 * webhook endpoint can short-circuit with 202.
 *
 * v1 handles three events — the ones that surface an actionable issue/PR:
 *
 *   - `issues` (action: `opened`)                  → `event = 'issues.opened'`
 *   - `pull_request` (action: `opened`)            → `event = 'pull_request.opened'`
 *   - `issue_comment` (action: `created`, on PR)   → `event = 'issue_comment.created'`
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
      },
      actor,
    };
  }

  // `issue_comment` fires for both issue and PR comments — gate on presence
  // of `pull_request` to scope to PR comments (Critic workflows).
  if (eventName === 'issue_comment' && action === 'created' && p.issue?.pull_request) {
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
      },
      actor,
    };
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
    pull_request?: unknown;
  };
  pull_request?: {
    id?: number | string;
    node_id?: string;
    number?: number;
    title?: string;
    html_url?: string;
  };
}

function extractRepo(
  r: GithubWebhookPayload['repository'],
): TriggerEvent['repo'] {
  if (!r?.owner?.login || !r.name) return undefined;
  return { owner: r.owner.login, name: r.name };
}
