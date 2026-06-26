import { describe, expect, it } from 'vitest';
import {
  CRON_EXPRESSION_RE,
  isCronTrigger,
  isPollingTrigger,
  isScheduledTrigger,
  offeredFilterFields,
  type TriggerConfig,
} from './config';

const BASE_FIELDS = {
  id: 'trigger-1',
  name: 'Trigger1',
  platform: 'github' as const,
  connectionId: 'conn_1',
};

const issuesTrigger = (boardConnectionId?: string): TriggerConfig => ({
  ...BASE_FIELDS,
  ...(boardConnectionId ? { boardConnectionId } : {}),
  type: 'issues',
  intervalSec: 60,
  filters: [],
});

const prTrigger: TriggerConfig = {
  ...BASE_FIELDS,
  type: 'pull_requests',
  intervalSec: 60,
  filters: [],
};

const cronTrigger: TriggerConfig = {
  ...BASE_FIELDS,
  type: 'cron',
  cron: '* * * * *',
  timezone: 'UTC',
  branch: 'main',
};

const webhookTrigger: TriggerConfig = {
  ...BASE_FIELDS,
  type: 'webhook',
  event: 'issues.opened',
  filters: [],
};

describe('CRON_EXPRESSION_RE', () => {
  it('accepts valid 5-field expressions', () => {
    expect(CRON_EXPRESSION_RE.test('* * * * *')).toBe(true);
    expect(CRON_EXPRESSION_RE.test('0 9 * * MON-FRI')).toBe(true);
    expect(CRON_EXPRESSION_RE.test('*/15 0 1,15 * *')).toBe(true);
    expect(CRON_EXPRESSION_RE.test('0 0 1 JAN *')).toBe(true);
  });

  it('rejects the wrong field count', () => {
    expect(CRON_EXPRESSION_RE.test('* * * *')).toBe(false); // 4 fields
    expect(CRON_EXPRESSION_RE.test('* * * * * *')).toBe(false); // 6 fields
  });

  it('rejects junk atoms and trailing whitespace', () => {
    // `!` is neither `*`, a number, a range, nor a 3-letter name.
    expect(CRON_EXPRESSION_RE.test('60 9 ! * *')).toBe(false);
    // Anchored at both ends — a trailing space leaves an empty 6th field.
    expect(CRON_EXPRESSION_RE.test('* * * * * ')).toBe(false);
    expect(CRON_EXPRESSION_RE.test('* * * * *  ')).toBe(false);
  });
});

describe('isPollingTrigger', () => {
  it('is true for polling-delivered variants', () => {
    expect(isPollingTrigger(issuesTrigger())).toBe(true);
    expect(isPollingTrigger(prTrigger)).toBe(true);
  });

  it('is false for non-polling variants and nullish input', () => {
    expect(isPollingTrigger(cronTrigger)).toBe(false);
    expect(isPollingTrigger(webhookTrigger)).toBe(false);
    expect(isPollingTrigger(null)).toBe(false);
    expect(isPollingTrigger(undefined)).toBe(false);
  });
});

describe('isCronTrigger', () => {
  it('is true only for cron', () => {
    expect(isCronTrigger(cronTrigger)).toBe(true);
    expect(isCronTrigger(issuesTrigger())).toBe(false);
    expect(isCronTrigger(prTrigger)).toBe(false);
    expect(isCronTrigger(webhookTrigger)).toBe(false);
    expect(isCronTrigger(null)).toBe(false);
    expect(isCronTrigger(undefined)).toBe(false);
  });
});

describe('isScheduledTrigger', () => {
  it('is true for issues, pull_requests, and cron', () => {
    expect(isScheduledTrigger(issuesTrigger())).toBe(true);
    expect(isScheduledTrigger(prTrigger)).toBe(true);
    expect(isScheduledTrigger(cronTrigger)).toBe(true);
  });

  it('is false for webhook and nullish input', () => {
    expect(isScheduledTrigger(webhookTrigger)).toBe(false);
    expect(isScheduledTrigger(null)).toBe(false);
    expect(isScheduledTrigger(undefined)).toBe(false);
  });
});

describe('offeredFilterFields', () => {
  it('pull_requests offers pr_state + label', () => {
    expect(offeredFilterFields(prTrigger)).toEqual(['pr_state', 'label']);
  });

  it('cron offers no filters', () => {
    expect(offeredFilterFields(cronTrigger)).toEqual([]);
  });

  it('issues offers status + label only when a board is attached', () => {
    expect(offeredFilterFields(issuesTrigger('board_1'))).toEqual(['status', 'label']);
    expect(offeredFilterFields(issuesTrigger())).toEqual(['label']);
  });

  it('webhook offers all three legacy fields', () => {
    expect(offeredFilterFields(webhookTrigger)).toEqual(['status', 'label', 'pr_state']);
  });
});
