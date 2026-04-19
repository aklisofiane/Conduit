import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { triggerEventSchema } from '../trigger/event';
import { normalizeGithubWebhook } from './github';

const FIXTURE_DIR = path.resolve(__dirname, '../../../../test/fixtures/events/github');

function load(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
}

/**
 * Runs the normalizer against checked-in payloads that mirror real GitHub
 * webhook shapes. Keeps the normalizer honest: if an upstream field name
 * changes these break long before the webhook endpoint does in production.
 */
describe('normalizeGithubWebhook — real payload fixtures', () => {
  it('issues.opened → TriggerEvent with full identity', () => {
    const evt = normalizeGithubWebhook('issues', load('issues.opened.json'));
    expect(evt).toMatchObject({
      source: 'github',
      mode: 'webhook',
      event: 'issues.opened',
      repo: { owner: 'acme', name: 'shop' },
      actor: 'alice',
      issue: {
        id: 'I_kwDOAbCdEf1234567',
        key: '42',
        title: 'Checkout crashes when cart is empty',
        url: 'https://github.com/acme/shop/issues/42',
      },
    });
    // Result shape must round-trip through the shared Zod schema so every
    // downstream consumer (worker, DB, WS clients) sees a valid event.
    expect(triggerEventSchema.safeParse(evt).success).toBe(true);
  });

  it('pull_request.opened → TriggerEvent with PR identity', () => {
    const evt = normalizeGithubWebhook('pull_request', load('pull_request.opened.json'));
    expect(evt).toMatchObject({
      event: 'pull_request.opened',
      actor: 'bob',
      issue: {
        id: 'PR_kwDOxxxx',
        key: '7',
        title: 'Fix checkout crash on empty cart',
        url: 'https://github.com/acme/shop/pull/7',
      },
    });
    expect(triggerEventSchema.safeParse(evt).success).toBe(true);
  });

  it('issue_comment.created on a PR → normalizes', () => {
    const evt = normalizeGithubWebhook('issue_comment', load('issue_comment.pr.json'));
    expect(evt?.event).toBe('issue_comment.created');
    expect(evt?.issue?.key).toBe('7');
    expect(evt?.actor).toBe('carol');
  });

  it('issue_comment.created on a plain issue → null (not routed in v1)', () => {
    const evt = normalizeGithubWebhook('issue_comment', load('issue_comment.issue.json'));
    expect(evt).toBeNull();
  });

  it('issues.closed → null (only .opened is routed in v1)', () => {
    expect(normalizeGithubWebhook('issues', load('issues.closed.json'))).toBeNull();
  });

  it('push → null (unsupported event type)', () => {
    expect(normalizeGithubWebhook('push', load('push.json'))).toBeNull();
  });

  it('issues.opened with no repository object still normalizes (repo omitted)', () => {
    const evt = normalizeGithubWebhook('issues', load('issues.opened.no-repo.json'));
    expect(evt?.event).toBe('issues.opened');
    expect(evt?.repo).toBeUndefined();
    expect(triggerEventSchema.safeParse(evt).success).toBe(true);
  });

  it('projects_v2_item Status change → board.column.changed', () => {
    const evt = normalizeGithubWebhook(
      'projects_v2_item',
      load('projects_v2_item.status_changed.json'),
    );
    expect(evt).toMatchObject({
      source: 'github',
      mode: 'webhook',
      event: 'board.column.changed',
      actor: 'alice',
    });
    // Schema round-trip — filter code downstream relies on parseable events.
    expect(triggerEventSchema.safeParse(evt).success).toBe(true);
  });
});
