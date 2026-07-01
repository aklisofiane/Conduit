import type { TriggerEvent, TriggerFilter } from '@conduit/shared';
import { applyFilter, capTriggerBody } from '@conduit/shared';
import type { ProjectBoardItem } from '@conduit/shared/platform';

/**
 * Build the `FilterView` for a project board item and run the trigger's
 * filters against it. Mirrors the webhook-side flatten+apply dance in
 * `matchesTrigger` so a single filter set works in either mode.
 */
export function itemPassesFilters(item: ProjectBoardItem, filters: TriggerFilter[]): boolean {
  const view = {
    status: item.singleSelectValues.Status,
    labels: item.labels,
    prState: item.pr?.state,
  };
  return filters.every((f) => applyFilter(view, f));
}

/**
 * A user/org-level GitHub Projects v2 board can aggregate issues from many
 * repos. A board-triggered workflow is still scoped to a single repo — its
 * source connection (`connectionId`) is the repo identity for the run (see
 * design-docs/connections.md). Keep only board items whose content lives in
 * that repo so a shared board never fans a run out onto a sibling repo (which
 * would also collide on `conduit/*` branch state with that repo's own
 * workflow). Draft items carry no `repo` and are dropped — they have no issue
 * identity to act on.
 */
export function itemInRepo(item: ProjectBoardItem, repo: { owner: string; repo: string }): boolean {
  return item.repo?.owner === repo.owner && item.repo?.name === repo.repo;
}

/**
 * Convert a project board item into the normalized `TriggerEvent` shape that
 * the matcher and downstream nodes consume. The `event` name and the
 * presence of `TriggerEvent.pr` are scope-driven:
 *
 * - `'issues'` → `event = 'board.column.changed'`, no `pr` block.
 * - `'pull_requests'` → `event = 'pull_request.detected'`, `pr` populated
 *   from the PR's head/base refs (and `headRepo` when the head lives in a
 *   different repo than the base, i.e. fork PR — same semantic as the
 *   webhook-side `extractPr`).
 *
 * `payload.prState` is written for any item carrying a `pr` block so the
 * matcher's `flattenEventForFilters` can read it back into the FilterView
 * for `pr_state` filters.
 */
export function toTriggerEvent(
  item: ProjectBoardItem,
  scope: 'issues' | 'pull_requests',
  platform: 'github' | 'gitlab' = 'github',
): TriggerEvent {
  const payload: Record<string, unknown> = {
    projectItemNodeId: item.itemNodeId,
    singleSelectValues: item.singleSelectValues,
    contentNodeId: item.contentNodeId,
    contentType: item.contentType,
  };
  // Surface Status directly on the payload so filter-flattener picks it up
  // and so downstream agents see the column name without having to dig.
  if (item.singleSelectValues.Status) {
    payload.status = item.singleSelectValues.Status;
  }
  if (item.labels.length > 0) {
    payload.labels = item.labels;
  }
  if (item.pr) {
    payload.prState = item.pr.state;
  }

  const event: TriggerEvent = {
    source: platform,
    mode: 'polling',
    event: scope === 'pull_requests' ? 'pull_request.detected' : 'board.column.changed',
    payload,
  };
  if (item.repo) event.repo = item.repo;
  if (item.contentNodeId && item.contentKey && item.contentTitle && item.contentUrl) {
    event.issue = {
      id: item.contentNodeId,
      key: item.contentKey,
      title: item.contentTitle,
      url: item.contentUrl,
      ...(typeof item.contentBody === 'string' ? { body: capTriggerBody(item.contentBody) } : {}),
    };
  }
  if (scope === 'pull_requests' && item.pr) {
    event.pr = {
      headRef: item.pr.headRef,
      baseRef: item.pr.baseRef,
      ...(item.pr.headRepo ? { headRepo: item.pr.headRepo } : {}),
    };
  }
  return event;
}
