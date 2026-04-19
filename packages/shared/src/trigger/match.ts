import type { TriggerConfig } from './config';
import type { TriggerEvent } from './event';
import type { TriggerFilter } from './filter';

/**
 * Returns true if the event matches the trigger configuration — event-name
 * check first (webhook mode only; polling/manual don't carry a specific
 * event name), then all filters (AND). Filters read fields off a flat view
 * of the event so the same syntax works across platforms without special
 * casing. See docs/design-docs/node-system.md.
 */
export function matchesTrigger(event: TriggerEvent, trigger: TriggerConfig): boolean {
  if (event.source !== trigger.platform) return false;

  if (trigger.mode.kind === 'webhook' && event.mode === 'webhook') {
    if (event.event !== trigger.mode.event) return false;
  }

  const fields = flattenEventForFilters(event);
  return trigger.filters.every((f) => applyFilter(fields, f));
}

/**
 * Public for tests + potential reuse by the polling trigger (which runs
 * filter logic after querying the platform API).
 */
export function applyFilter(fields: Record<string, string>, filter: TriggerFilter): boolean {
  const actual = fields[filter.field];
  if (actual === undefined) return false;
  switch (filter.op) {
    case 'eq':
      return typeof filter.value === 'string' && actual === filter.value;
    case 'neq':
      return typeof filter.value === 'string' && actual !== filter.value;
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(actual);
    case 'contains':
      return typeof filter.value === 'string' && actual.includes(filter.value);
    default: {
      const _exhaustive: never = filter.op;
      return _exhaustive;
    }
  }
}

/**
 * Flattens the event into a string-keyed view for filter matching. Keeps
 * the matcher dumb — anything platform-specific the user wants to filter
 * on must first be exposed here.
 */
function flattenEventForFilters(event: TriggerEvent): Record<string, string> {
  const out: Record<string, string> = {
    event: event.event,
    source: event.source,
  };
  if (event.actor) out.actor = event.actor;
  if (event.repo) {
    out['repo.owner'] = event.repo.owner;
    out['repo.name'] = event.repo.name;
  }
  if (event.issue) {
    out['issue.key'] = event.issue.key;
    out['issue.title'] = event.issue.title;
  }

  // Surface a handful of platform-useful fields from the raw payload so
  // users can write filters like `{ field: 'label', op: 'eq', value: 'bug' }`
  // without schema-juggling. Keep this narrow — growing it slowly is fine.
  const labels = getLabels(event.payload);
  if (labels.length) out.label = labels.join(',');

  const status = getStatus(event.payload);
  if (status !== undefined) out.status = status;

  const assignee = getAssignee(event.payload);
  if (assignee !== undefined) out.assignee = assignee;

  return out;
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
  // column name to `payload.status` directly so `status = X` filters work in
  // either mode. Other platforms land here later.
  const direct = (payload as { status?: unknown }).status;
  if (typeof direct === 'string') return direct;
  const changes = (payload as { changes?: { field_value?: { to?: { name?: unknown } } } }).changes;
  const to = changes?.field_value?.to?.name;
  return typeof to === 'string' ? to : undefined;
}

function getAssignee(payload: Record<string, unknown>): string | undefined {
  const issue = (payload.issue ?? payload.pull_request) as
    | { assignee?: { login?: unknown } }
    | undefined;
  const login = issue?.assignee?.login;
  return typeof login === 'string' ? login : undefined;
}
