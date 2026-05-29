import { describe, expect, it } from 'vitest';
import type { ProjectBoardItem } from '@conduit/shared/platform';
import { itemPassesFilters, toTriggerEvent } from './poll-board-helpers';

const ISSUE_ITEM: ProjectBoardItem = {
  itemNodeId: 'PVTI_ISSUE_1',
  contentNodeId: 'I_1',
  contentType: 'Issue',
  contentKey: '42',
  contentTitle: 'Crash on save',
  contentUrl: 'https://github.com/acme/shop/issues/42',
  repo: { owner: 'acme', name: 'shop' },
  singleSelectValues: { Status: 'Dev' },
  labels: ['bug'],
};

const PR_ITEM: ProjectBoardItem = {
  itemNodeId: 'PVTI_PR_1',
  contentNodeId: 'PR_1',
  contentType: 'PullRequest',
  contentKey: '7',
  contentTitle: 'Implement feature X',
  contentUrl: 'https://github.com/acme/shop/pull/7',
  repo: { owner: 'acme', name: 'shop' },
  singleSelectValues: { Status: 'Review' },
  labels: ['enhancement'],
  pr: {
    headRef: 'feature-x',
    baseRef: 'main',
    state: 'ready_for_review',
  },
};

describe('itemPassesFilters', () => {
  it('passes a PR item under `pr_state: ready_for_review` when isDraft is false', () => {
    expect(
      itemPassesFilters(PR_ITEM, [
        { field: 'pr_state', value: 'ready_for_review' },
      ]),
    ).toBe(true);
  });

  it('rejects a draft PR under `pr_state: ready_for_review`', () => {
    const draft: ProjectBoardItem = {
      ...PR_ITEM,
      pr: { ...PR_ITEM.pr!, state: 'draft' },
    };
    expect(
      itemPassesFilters(draft, [{ field: 'pr_state', value: 'ready_for_review' }]),
    ).toBe(false);
  });

  it('matches both PR states under `pr_state: any`', () => {
    const draft: ProjectBoardItem = {
      ...PR_ITEM,
      pr: { ...PR_ITEM.pr!, state: 'draft' },
    };
    expect(itemPassesFilters(PR_ITEM, [{ field: 'pr_state', value: 'any' }])).toBe(true);
    expect(itemPassesFilters(draft, [{ field: 'pr_state', value: 'any' }])).toBe(true);
  });

  it('AND-combines status and label filters against an issue item', () => {
    expect(
      itemPassesFilters(ISSUE_ITEM, [
        { field: 'status', value: 'Dev' },
        { field: 'label', value: 'bug' },
      ]),
    ).toBe(true);
    expect(
      itemPassesFilters(ISSUE_ITEM, [
        { field: 'status', value: 'Dev' },
        { field: 'label', value: 'chore' },
      ]),
    ).toBe(false);
  });
});

describe('toTriggerEvent', () => {
  it('issue scope emits `board.column.changed` and skips the pr block', () => {
    const event = toTriggerEvent(ISSUE_ITEM, 'issues');
    expect(event.event).toBe('board.column.changed');
    expect(event.pr).toBeUndefined();
    expect(event.payload.prState).toBeUndefined();
    expect(event.issue?.key).toBe('42');
    expect(event.payload.status).toBe('Dev');
  });

  it('PR scope emits `pull_request.detected`, populates `pr`, sets `payload.prState`', () => {
    const event = toTriggerEvent(PR_ITEM, 'pull_requests');
    expect(event.event).toBe('pull_request.detected');
    expect(event.pr).toEqual({ headRef: 'feature-x', baseRef: 'main' });
    expect(event.payload.prState).toBe('ready_for_review');
    // Issue identity is still populated for PRs so filters keying on
    // `issue.key` keep working unchanged.
    expect(event.issue?.key).toBe('7');
  });

  it('PR scope surfaces `pr.headRepo` for fork PRs', () => {
    const fork: ProjectBoardItem = {
      ...PR_ITEM,
      pr: {
        ...PR_ITEM.pr!,
        headRepo: { owner: 'contributor', name: 'shop' },
      },
    };
    const event = toTriggerEvent(fork, 'pull_requests');
    expect(event.pr?.headRepo).toEqual({ owner: 'contributor', name: 'shop' });
  });

  it('PR-shaped item routed under `issues` scope drops the pr block (UI never wires this, but the function is symmetric)', () => {
    const event = toTriggerEvent(PR_ITEM, 'issues');
    expect(event.event).toBe('board.column.changed');
    expect(event.pr).toBeUndefined();
    // `payload.prState` is still surfaced on the payload (the matcher uses
    // it via `flattenEventForFilters`); only the top-level `pr` block is
    // gated on scope.
    expect(event.payload.prState).toBe('ready_for_review');
  });

  it('forwards `contentBody` from the board item to `event.issue.body`', () => {
    const withBody: ProjectBoardItem = {
      ...ISSUE_ITEM,
      contentBody: 'Steps to reproduce:\n1. Open cart\n2. Crash',
    };
    expect(toTriggerEvent(withBody, 'issues').issue?.body).toBe(
      'Steps to reproduce:\n1. Open cart\n2. Crash',
    );
  });

  it('omits `event.issue.body` when the board item has no `contentBody`', () => {
    expect(toTriggerEvent(ISSUE_ITEM, 'issues').issue?.body).toBeUndefined();
  });
});
