import type { TriggerEvent } from '../trigger/event';

/**
 * Normalize a GitLab webhook delivery into our cross-platform `TriggerEvent`.
 * Returns `null` for event types we don't route so the webhook endpoint can
 * short-circuit with 200.
 *
 * v1 handles three events — the ones that surface an actionable issue/MR or
 * a comment on an MR:
 *
 *   - `Issue Hook` (action: `open`)                                → `event = 'issues.opened'`
 *   - `Merge Request Hook` (action: `open`)                        → `event = 'pull_request.opened'`
 *   - `Note Hook` (noteable_type: `MergeRequest`, any create)      → `event = 'issue_comment.created'`
 *
 * Other actions on those same event types (update, close, reopen, label…)
 * are intentionally dropped for now; wire them in when a workflow needs them.
 *
 * Note-hook gating: only MR comments are surfaced in v1; Issue/Commit/Snippet
 * notes are dropped (return `null`) — matching the GitHub normalizer's
 * `issue.pull_request` presence gate for `issue_comment`.
 */
export function normalizeGitlabWebhook(
  eventName: string,
  payload: unknown,
): TriggerEvent | null {
  const p = payload as GitlabWebhookPayload | null | undefined;
  if (!p || typeof p !== 'object') return null;

  const oa = p.object_attributes;
  const action = typeof oa?.action === 'string' ? oa.action : undefined;
  const repo = extractRepo(p.project);
  const actor = p.user?.username;

  if (eventName === 'Issue Hook' && action === 'open' && oa) {
    return {
      source: 'gitlab',
      mode: 'webhook',
      event: 'issues.opened',
      payload: p as Record<string, unknown>,
      repo,
      issue: {
        id: String(oa.id ?? ''),
        key: String(oa.iid ?? ''),
        title: String(oa.title ?? ''),
        url: String(oa.url ?? ''),
      },
      actor,
    };
  }

  if (eventName === 'Merge Request Hook' && action === 'open' && oa) {
    return {
      source: 'gitlab',
      mode: 'webhook',
      event: 'pull_request.opened',
      payload: p as Record<string, unknown>,
      repo,
      issue: {
        id: String(oa.id ?? ''),
        key: String(oa.iid ?? ''),
        title: String(oa.title ?? ''),
        url: String(oa.url ?? ''),
      },
      pr: extractPr(oa),
      actor,
    };
  }

  // Note Hook — only MR comments are surfaced in v1. Issue/Commit/Snippet
  // notes are dropped to match the GitHub normalizer's PR-comment gate.
  if (eventName === 'Note Hook' && oa?.noteable_type === 'MergeRequest') {
    // The merge_request sub-object carries the MR identity for the comment.
    const mr = p.merge_request;
    if (!mr) return null;
    return {
      source: 'gitlab',
      mode: 'webhook',
      event: 'issue_comment.created',
      payload: p as Record<string, unknown>,
      repo,
      issue: {
        id: String(mr.id ?? ''),
        key: String(mr.iid ?? ''),
        title: String(mr.title ?? ''),
        url: String(mr.url ?? ''),
      },
      actor,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal types — minimal shapes matching the subset of GitLab's webhook
// payload that the normalizer actually reads.
// ---------------------------------------------------------------------------

interface GitlabWebhookPayload {
  object_attributes?: {
    id?: number | string;
    iid?: number | string;
    action?: string;
    title?: string;
    url?: string;
    source_branch?: string;
    target_branch?: string;
    noteable_type?: string;
  };
  project?: {
    path_with_namespace?: string;
  };
  user?: {
    username?: string;
  };
  merge_request?: {
    id?: number | string;
    iid?: number | string;
    title?: string;
    url?: string;
    source_branch?: string;
    target_branch?: string;
  };
}

/**
 * Derive `{ owner, name }` from `project.path_with_namespace`. GitLab paths
 * may include subgroups (`group/subgroup/project`); we take the last two
 * segments so "group/subgroup/repo" → `{ owner: 'subgroup', name: 'repo' }`.
 */
function extractRepo(
  project: GitlabWebhookPayload['project'],
): TriggerEvent['repo'] {
  const full = project?.path_with_namespace;
  if (!full) return undefined;
  const parts = full.split('/');
  if (parts.length < 2) return undefined;
  const name = parts[parts.length - 1]!;
  const owner = parts[parts.length - 2]!;
  if (!owner || !name) return undefined;
  return { owner, name };
}

/**
 * Pull head/base branch refs out of `object_attributes` for MR events.
 * Fork head-repo resolution is deferred — GitLab carries numeric project IDs,
 * not paths, for the source project. Revisit when a workflow needs it.
 */
function extractPr(
  oa: NonNullable<GitlabWebhookPayload['object_attributes']>,
): TriggerEvent['pr'] {
  const headRef = oa.source_branch;
  const baseRef = oa.target_branch;
  if (!headRef || !baseRef) return undefined;
  return { headRef, baseRef };
}
