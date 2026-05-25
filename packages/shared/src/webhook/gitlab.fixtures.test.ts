import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { triggerEventSchema } from '../trigger/event';
import { normalizeGitlabWebhook } from './gitlab';

const FIXTURE_DIR = path.resolve(__dirname, '../../../../test/fixtures/events/gitlab');

function load(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
}

/**
 * Runs the normalizer against checked-in payloads that mirror real GitLab
 * webhook shapes. Keeps the normalizer honest: if an upstream field name
 * changes these break long before the webhook endpoint does in production.
 */
describe('normalizeGitlabWebhook — real payload fixtures', () => {
  it('issue_hook.opened → TriggerEvent with full identity', () => {
    const evt = normalizeGitlabWebhook('Issue Hook', load('issue_hook.opened.json'));
    expect(evt).toMatchObject({
      source: 'gitlab',
      mode: 'webhook',
      event: 'issues.opened',
      repo: { owner: 'acme', name: 'shop' },
      actor: 'alice',
      issue: {
        id: '301',
        key: '42',
        title: 'Checkout crashes when cart is empty',
        url: 'https://gitlab.com/acme/shop/-/issues/42',
      },
    });
    // Result shape must round-trip through the shared Zod schema so every
    // downstream consumer (worker, DB, WS clients) sees a valid event.
    expect(triggerEventSchema.safeParse(evt).success).toBe(true);
  });

  it('merge_request_hook.opened → TriggerEvent with PR identity', () => {
    const evt = normalizeGitlabWebhook(
      'Merge Request Hook',
      load('merge_request_hook.opened.json'),
    );
    expect(evt).toMatchObject({
      event: 'pull_request.opened',
      actor: 'bob',
      issue: {
        id: '401',
        key: '7',
        title: 'Fix checkout crash on empty cart',
        url: 'https://gitlab.com/acme/shop/-/merge_requests/7',
      },
      pr: {
        headRef: 'fix/checkout-empty-cart',
        baseRef: 'main',
      },
    });
    expect(triggerEventSchema.safeParse(evt).success).toBe(true);
  });

  it('note_hook.mr → issue_comment.created with MR identity', () => {
    const evt = normalizeGitlabWebhook('Note Hook', load('note_hook.mr.json'));
    expect(evt?.event).toBe('issue_comment.created');
    expect(evt?.issue?.key).toBe('7');
    expect(evt?.actor).toBe('carol');
    expect(triggerEventSchema.safeParse(evt).success).toBe(true);
  });

  it('note_hook.issue → null (only MR comments are routed in v1)', () => {
    const evt = normalizeGitlabWebhook('Note Hook', load('note_hook.issue.json'));
    expect(evt).toBeNull();
  });

  it('subgroup MR hook → repo uses last two path segments', () => {
    const evt = normalizeGitlabWebhook(
      'Merge Request Hook',
      load('subgroup.merge_request_hook.opened.json'),
    );
    expect(evt?.event).toBe('pull_request.opened');
    expect(evt?.repo).toEqual({ owner: 'frontend', name: 'shop' });
    expect(evt?.issue?.key).toBe('3');
    expect(triggerEventSchema.safeParse(evt).success).toBe(true);
  });
});
