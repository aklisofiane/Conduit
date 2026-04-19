import { describe, expect, it } from 'vitest';
import type { TriggerConfig } from './config';
import type { TriggerEvent } from './event';
import { applyFilter, matchesTrigger } from './match';

const BASE_EVENT: TriggerEvent = {
  source: 'github',
  mode: 'webhook',
  event: 'issues.opened',
  payload: {
    issue: {
      labels: [{ name: 'bug' }, { name: 'priority:high' }],
      assignee: { login: 'alice' },
    },
  },
  repo: { owner: 'acme', name: 'shop' },
  issue: { id: 'node_1', key: '42', title: 'Crash', url: 'https://x' },
  actor: 'alice',
};

const BASE_TRIGGER: TriggerConfig = {
  platform: 'github',
  connectionId: 'conn_1',
  mode: { kind: 'webhook', event: 'issues.opened', active: true },
  filters: [],
};

describe('matchesTrigger', () => {
  it('matches when platform + event agree and no filters', () => {
    expect(matchesTrigger(BASE_EVENT, BASE_TRIGGER)).toBe(true);
  });

  it('rejects when platform differs', () => {
    expect(matchesTrigger({ ...BASE_EVENT, source: 'gitlab' }, BASE_TRIGGER)).toBe(false);
  });

  it('rejects when webhook event name differs', () => {
    expect(
      matchesTrigger(BASE_EVENT, {
        ...BASE_TRIGGER,
        mode: { kind: 'webhook', event: 'pull_request.opened', active: true },
      }),
    ).toBe(false);
  });

  it('skips event-name check for polling-mode triggers', () => {
    expect(
      matchesTrigger(
        { ...BASE_EVENT, mode: 'polling', event: 'status.changed' },
        {
          ...BASE_TRIGGER,
          mode: { kind: 'polling', intervalSec: 60, active: true },
        },
      ),
    ).toBe(true);
  });

  it('AND-combines filters — all must pass', () => {
    const trigger: TriggerConfig = {
      ...BASE_TRIGGER,
      filters: [
        { field: 'actor', op: 'eq', value: 'alice' },
        { field: 'repo.owner', op: 'eq', value: 'acme' },
      ],
    };
    expect(matchesTrigger(BASE_EVENT, trigger)).toBe(true);
    expect(
      matchesTrigger({ ...BASE_EVENT, actor: 'bob' }, trigger),
    ).toBe(false);
  });

  it('filters on labels via the surfaced `label` field', () => {
    expect(
      matchesTrigger(BASE_EVENT, {
        ...BASE_TRIGGER,
        filters: [{ field: 'label', op: 'contains', value: 'bug' }],
      }),
    ).toBe(true);
  });

  it('matches board.column.changed webhook via `status = Dev`', () => {
    const webhookEvent: TriggerEvent = {
      source: 'github',
      mode: 'webhook',
      event: 'board.column.changed',
      payload: {
        changes: { field_value: { field_name: 'Status', to: { name: 'Dev' } } },
      },
    };
    const trigger: TriggerConfig = {
      platform: 'github',
      connectionId: 'conn_1',
      mode: { kind: 'webhook', event: 'board.column.changed', active: true },
      filters: [{ field: 'status', op: 'eq', value: 'Dev' }],
    };
    expect(matchesTrigger(webhookEvent, trigger)).toBe(true);
  });

  it('matches a polling-synthesized event via `status = Dev`', () => {
    // Polling writes the column name directly to payload.status so the same
    // filter works regardless of how the event arrived.
    const pollingEvent: TriggerEvent = {
      source: 'github',
      mode: 'polling',
      event: 'board.column.changed',
      payload: { status: 'Dev' },
      issue: { id: 'I_1', key: '42', title: 't', url: 'https://x' },
    };
    const trigger: TriggerConfig = {
      platform: 'github',
      connectionId: 'conn_1',
      mode: { kind: 'polling', intervalSec: 60, active: true },
      filters: [{ field: 'status', op: 'eq', value: 'Dev' }],
    };
    expect(matchesTrigger(pollingEvent, trigger)).toBe(true);
  });
});

describe('applyFilter', () => {
  const fields = { status: 'Dev', label: 'bug,priority:high', assignee: 'alice' };

  it('eq', () => {
    expect(applyFilter(fields, { field: 'status', op: 'eq', value: 'Dev' })).toBe(true);
    expect(applyFilter(fields, { field: 'status', op: 'eq', value: 'Review' })).toBe(false);
  });

  it('neq', () => {
    expect(applyFilter(fields, { field: 'status', op: 'neq', value: 'Review' })).toBe(true);
  });

  it('in', () => {
    expect(
      applyFilter(fields, { field: 'status', op: 'in', value: ['Dev', 'AIReview'] }),
    ).toBe(true);
    expect(applyFilter(fields, { field: 'status', op: 'in', value: ['Done'] })).toBe(false);
  });

  it('contains', () => {
    expect(applyFilter(fields, { field: 'label', op: 'contains', value: 'bug' })).toBe(true);
    expect(applyFilter(fields, { field: 'label', op: 'contains', value: 'chore' })).toBe(false);
  });

  it('rejects when the field is not surfaced', () => {
    expect(applyFilter(fields, { field: 'nope', op: 'eq', value: 'x' })).toBe(false);
  });
});
