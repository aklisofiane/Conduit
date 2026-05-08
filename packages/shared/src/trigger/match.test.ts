import { describe, expect, it } from 'vitest';
import type { TriggerConfig } from './config';
import type { TriggerEvent } from './event';
import { applyFilter, matchesTrigger, type FilterView } from './match';

const BASE_EVENT: TriggerEvent = {
  source: 'github',
  mode: 'webhook',
  event: 'issues.opened',
  payload: {
    issue: {
      labels: [{ name: 'bug' }, { name: 'priority:high' }],
    },
  },
  repo: { owner: 'acme', name: 'shop' },
  issue: { id: 'node_1', key: '42', title: 'Crash', url: 'https://x' },
  actor: 'alice',
};

const BASE_TRIGGER: TriggerConfig = {
  id: 'trigger-1',
  name: 'Trigger1',
  platform: 'github',
  connectionId: 'conn_1',
  mode: { kind: 'webhook', event: 'issues.opened' },
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
        mode: { kind: 'webhook', event: 'pull_request.opened' },
      }),
    ).toBe(false);
  });

  it('skips event-name check for polling-mode triggers', () => {
    expect(
      matchesTrigger(
        { ...BASE_EVENT, mode: 'polling', event: 'status.changed' },
        {
          ...BASE_TRIGGER,
          mode: { kind: 'polling', intervalSec: 60, scope: 'issues', source: 'board' },
        },
      ),
    ).toBe(true);
  });

  it('AND-combines status + label filters — all must pass', () => {
    const trigger: TriggerConfig = {
      ...BASE_TRIGGER,
      mode: { kind: 'webhook', event: 'board.column.changed' },
      filters: [
        { field: 'status', value: 'Dev' },
        { field: 'label', value: 'bug' },
      ],
    };
    const event: TriggerEvent = {
      source: 'github',
      mode: 'webhook',
      event: 'board.column.changed',
      payload: {
        status: 'Dev',
        issue: { labels: [{ name: 'bug' }] },
      },
    };
    expect(matchesTrigger(event, trigger)).toBe(true);
    expect(
      matchesTrigger(
        {
          ...event,
          payload: { status: 'Dev', issue: { labels: [{ name: 'chore' }] } },
        },
        trigger,
      ),
    ).toBe(false);
  });

  it('matches a label filter via membership on the issue payload', () => {
    expect(
      matchesTrigger(BASE_EVENT, {
        ...BASE_TRIGGER,
        filters: [{ field: 'label', value: 'bug' }],
      }),
    ).toBe(true);
    expect(
      matchesTrigger(BASE_EVENT, {
        ...BASE_TRIGGER,
        filters: [{ field: 'label', value: 'priority:high' }],
      }),
    ).toBe(true);
    expect(
      matchesTrigger(BASE_EVENT, {
        ...BASE_TRIGGER,
        filters: [{ field: 'label', value: 'nope' }],
      }),
    ).toBe(false);
  });

  it('AND-combines two label rows — issue must have both labels', () => {
    const trigger: TriggerConfig = {
      ...BASE_TRIGGER,
      filters: [
        { field: 'label', value: 'bug' },
        { field: 'label', value: 'priority:high' },
      ],
    };
    expect(matchesTrigger(BASE_EVENT, trigger)).toBe(true);
    expect(
      matchesTrigger(
        {
          ...BASE_EVENT,
          payload: { issue: { labels: [{ name: 'bug' }] } },
        },
        trigger,
      ),
    ).toBe(false);
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
      ...BASE_TRIGGER,
      mode: { kind: 'webhook', event: 'board.column.changed' },
      filters: [{ field: 'status', value: 'Dev' }],
    };
    expect(matchesTrigger(webhookEvent, trigger)).toBe(true);
  });

  it('matches a polling-synthesized event via `status = Dev`', () => {
    const pollingEvent: TriggerEvent = {
      source: 'github',
      mode: 'polling',
      event: 'board.column.changed',
      payload: { status: 'Dev' },
      issue: { id: 'I_1', key: '42', title: 't', url: 'https://x' },
    };
    const trigger: TriggerConfig = {
      ...BASE_TRIGGER,
      mode: { kind: 'polling', intervalSec: 60, scope: 'issues', source: 'board' },
      filters: [{ field: 'status', value: 'Dev' }],
    };
    expect(matchesTrigger(pollingEvent, trigger)).toBe(true);
  });

  it('matches a polling-PR event via `pr_state = ready_for_review`', () => {
    const event: TriggerEvent = {
      source: 'github',
      mode: 'polling',
      event: 'pull_request.detected',
      payload: { prState: 'ready_for_review' },
      issue: { id: 'PR_1', key: '7', title: 't', url: 'https://x' },
      pr: { headRef: 'feature-x', baseRef: 'main' },
    };
    const trigger: TriggerConfig = {
      ...BASE_TRIGGER,
      mode: { kind: 'polling', intervalSec: 60, scope: 'pull_requests', source: 'board' },
      filters: [{ field: 'pr_state', value: 'ready_for_review' }],
    };
    expect(matchesTrigger(event, trigger)).toBe(true);
  });

  it('rejects a polling-PR event whose pr_state mismatches', () => {
    const draftEvent: TriggerEvent = {
      source: 'github',
      mode: 'polling',
      event: 'pull_request.detected',
      payload: { prState: 'draft' },
      pr: { headRef: 'feature-x', baseRef: 'main' },
    };
    const trigger: TriggerConfig = {
      ...BASE_TRIGGER,
      mode: { kind: 'polling', intervalSec: 60, scope: 'pull_requests', source: 'board' },
      filters: [{ field: 'pr_state', value: 'ready_for_review' }],
    };
    expect(matchesTrigger(draftEvent, trigger)).toBe(false);
  });

  it('pr_state: any always matches regardless of payload state', () => {
    const draftEvent: TriggerEvent = {
      source: 'github',
      mode: 'polling',
      event: 'pull_request.detected',
      payload: { prState: 'draft' },
    };
    const readyEvent: TriggerEvent = {
      ...draftEvent,
      payload: { prState: 'ready_for_review' },
    };
    const trigger: TriggerConfig = {
      ...BASE_TRIGGER,
      mode: { kind: 'polling', intervalSec: 60, scope: 'pull_requests', source: 'board' },
      filters: [{ field: 'pr_state', value: 'any' }],
    };
    expect(matchesTrigger(draftEvent, trigger)).toBe(true);
    expect(matchesTrigger(readyEvent, trigger)).toBe(true);
  });
});

describe('applyFilter', () => {
  const view: FilterView = { status: 'Dev', labels: ['bug', 'priority:high'] };

  it('status — exact match', () => {
    expect(applyFilter(view, { field: 'status', value: 'Dev' })).toBe(true);
    expect(applyFilter(view, { field: 'status', value: 'Review' })).toBe(false);
  });

  it('status — undefined view value fails', () => {
    expect(applyFilter({ labels: [] }, { field: 'status', value: 'Dev' })).toBe(false);
  });

  it('status — empty value never matches (in-progress UI row)', () => {
    expect(applyFilter(view, { field: 'status', value: '' })).toBe(false);
  });

  it('label — exact membership', () => {
    expect(applyFilter(view, { field: 'label', value: 'bug' })).toBe(true);
    expect(applyFilter(view, { field: 'label', value: 'priority:high' })).toBe(true);
    expect(applyFilter(view, { field: 'label', value: 'nope' })).toBe(false);
  });

  it('label — empty value never matches (in-progress UI row)', () => {
    expect(applyFilter(view, { field: 'label', value: '' })).toBe(false);
  });

  it('label — empty labels view never matches', () => {
    expect(applyFilter({ labels: [] }, { field: 'label', value: 'bug' })).toBe(false);
  });

  it('pr_state — exact match', () => {
    const prView: FilterView = { labels: [], prState: 'ready_for_review' };
    expect(
      applyFilter(prView, { field: 'pr_state', value: 'ready_for_review' }),
    ).toBe(true);
    expect(applyFilter(prView, { field: 'pr_state', value: 'draft' })).toBe(false);
  });

  it('pr_state — `any` always matches', () => {
    const draftView: FilterView = { labels: [], prState: 'draft' };
    const readyView: FilterView = { labels: [], prState: 'ready_for_review' };
    const noneView: FilterView = { labels: [] };
    expect(applyFilter(draftView, { field: 'pr_state', value: 'any' })).toBe(true);
    expect(applyFilter(readyView, { field: 'pr_state', value: 'any' })).toBe(true);
    // Even when prState is undefined (e.g. an issue-shaped event leaking
    // through), `any` short-circuits to true.
    expect(applyFilter(noneView, { field: 'pr_state', value: 'any' })).toBe(true);
  });

  it('pr_state — undefined prState fails for concrete values (webhook-side fail-closed)', () => {
    expect(
      applyFilter({ labels: [] }, { field: 'pr_state', value: 'draft' }),
    ).toBe(false);
    expect(
      applyFilter({ labels: [] }, { field: 'pr_state', value: 'ready_for_review' }),
    ).toBe(false);
  });
});
