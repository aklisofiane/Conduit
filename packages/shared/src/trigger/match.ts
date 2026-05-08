import type { TriggerConfig } from './config';
import type { TriggerEvent } from './event';
import type { TriggerFilter } from './filter';

/**
 * Flat per-event view that the matcher reads. Webhook and polling each
 * produce one of these from their native shape, keeping the matcher
 * platform-agnostic.
 */
export interface FilterView {
  status?: string;
  labels: string[];
}

export function matchesTrigger(event: TriggerEvent, trigger: TriggerConfig): boolean {
  if (event.source !== trigger.platform) return false;

  // Polling-mode events don't carry a specific event name, so skip the check.
  if (trigger.mode.kind === 'webhook' && event.mode === 'webhook') {
    if (event.event !== trigger.mode.event) return false;
  }

  const view = flattenEventForFilters(event);
  return trigger.filters.every((f) => applyFilter(view, f));
}

export function applyFilter(view: FilterView, filter: TriggerFilter): boolean {
  // Empty value never matches — lets in-progress UI rows safe-fail without
  // hitting whatever the data happens to be.
  if (filter.value === '') return false;
  switch (filter.field) {
    case 'status':
      return view.status === filter.value;
    case 'label':
      return view.labels.includes(filter.value);
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}

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
