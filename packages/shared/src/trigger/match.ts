import type { TriggerConfig } from './config';
import type { TriggerEvent } from './event';
import type { TriggerFilter } from './filter';

/**
 * Flat per-event view that the matcher reads. Webhook and polling each
 * produce one of these from their native shape; the matcher itself stays
 * platform-agnostic.
 */
export interface FilterView {
  /** Project board Status column value, when present. */
  status?: string;
  /** Issue/PR label names. Empty array when there are none — never undefined. */
  labels: string[];
}

/**
 * Returns true if the event matches the trigger configuration — event-name
 * check first (webhook mode only; polling doesn't carry a specific event
 * name), then all filters (AND).
 */
export function matchesTrigger(event: TriggerEvent, trigger: TriggerConfig): boolean {
  if (event.source !== trigger.platform) return false;

  if (trigger.mode.kind === 'webhook' && event.mode === 'webhook') {
    if (event.event !== trigger.mode.event) return false;
  }

  const view = flattenEventForFilters(event);
  return trigger.filters.every((f) => applyFilter(view, f));
}

/**
 * Public for tests and reuse by the polling activity, which builds its own
 * `FilterView` from a `ProjectBoardItem`.
 */
export function applyFilter(view: FilterView, filter: TriggerFilter): boolean {
  switch (filter.field) {
    case 'status':
      return view.status !== undefined && view.status === filter.value;
    case 'label':
      return filter.value !== '' && view.labels.includes(filter.value);
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}

/**
 * Build a `FilterView` from a webhook-side `TriggerEvent`. Polling builds
 * its own view directly from the GraphQL response (see `poll-board.ts`).
 */
function flattenEventForFilters(event: TriggerEvent): FilterView {
  return {
    status: getStatus(event.payload),
    labels: getLabels(event.payload),
  };
}

function getLabels(payload: Record<string, unknown>): string[] {
  const issue = (payload.issue ?? payload.pull_request) as
    | { labels?: Array<{ name?: string }> }
    | undefined;
  const names = issue?.labels?.map((l) => l?.name).filter((n): n is string => Boolean(n));
  return names ?? [];
}

function getStatus(payload: Record<string, unknown>): string | undefined {
  // Webhook: GitHub projects_v2_item.edited carries the new column name at
  // `changes.field_value.to.name`. Polling: the poller writes the current
  // column name to `payload.status` directly so `status = X` filters work
  // in either mode. Other platforms land here later.
  const direct = (payload as { status?: unknown }).status;
  if (typeof direct === 'string') return direct;
  const changes = (payload as { changes?: { field_value?: { to?: { name?: unknown } } } }).changes;
  const to = changes?.field_value?.to?.name;
  return typeof to === 'string' ? to : undefined;
}
