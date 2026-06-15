import { describe, expect, it } from 'vitest';
import {
  agentWorkflowId,
  buildTemporalSlug,
  cronWorkflowId,
  pollWorkflowId,
  workflowScheduleId,
} from './queue';

const CUID = 'cmqc6hclk0001pk0120wulvnx';

describe('buildTemporalSlug', () => {
  it('composes <wf>-<conn> from both segments', () => {
    expect(buildTemporalSlug('Nightly Triage', 'acme/api')).toBe('nightly-triage-acme-api');
  });

  it('kebab-slugifies each segment to [a-z0-9-]', () => {
    expect(buildTemporalSlug('Build & Deploy!', 'My_Repo (v2)')).toBe('build-deploy-my-repo-v2');
  });

  it('caps each segment at 20 chars independently', () => {
    // 30-char name → 20; 30-char conn → 20; joined with a single dash.
    expect(buildTemporalSlug('a'.repeat(30), 'b'.repeat(30))).toBe(
      `${'a'.repeat(20)}-${'b'.repeat(20)}`,
    );
  });

  it('drops a trailing dash created by the 20-char cut', () => {
    // 19 chars + separator lands the cut on a dash → trimmed.
    expect(buildTemporalSlug('word-word-word-word-tail')).toBe('word-word-word-word');
  });

  it('falls back to name only when no connection name is given', () => {
    expect(buildTemporalSlug('Nightly Triage')).toBe('nightly-triage');
  });

  it('falls back to name only when the connection name slugs to empty', () => {
    expect(buildTemporalSlug('Nightly Triage', '!!!')).toBe('nightly-triage');
  });

  it('returns empty string when the workflow name slugs to empty', () => {
    expect(buildTemporalSlug('!!!', 'acme/api')).toBe('');
    expect(buildTemporalSlug('')).toBe('');
  });
});

describe('id builders — slug-less (legacy) output', () => {
  it('workflowScheduleId matches the pre-slug format verbatim', () => {
    expect(workflowScheduleId(CUID)).toBe(`poll-${CUID}`);
    expect(workflowScheduleId(CUID, '')).toBe(`poll-${CUID}`);
    expect(workflowScheduleId(CUID, undefined)).toBe(`poll-${CUID}`);
  });

  it('pollWorkflowId matches the pre-slug format verbatim', () => {
    expect(pollWorkflowId(CUID)).toBe(`poll-run-${CUID}`);
    expect(pollWorkflowId(CUID, '')).toBe(`poll-run-${CUID}`);
  });

  it('cronWorkflowId matches the pre-slug format verbatim', () => {
    expect(cronWorkflowId(CUID)).toBe(`cron-run-${CUID}`);
    expect(cronWorkflowId(CUID, '')).toBe(`cron-run-${CUID}`);
  });

  it('agentWorkflowId (per-run) matches the pre-slug format verbatim', () => {
    expect(agentWorkflowId(CUID)).toBe(`run-${CUID}`);
    expect(agentWorkflowId(CUID, undefined, '')).toBe(`run-${CUID}`);
  });

  it('agentWorkflowId (ticket-branch) matches the pre-slug format verbatim', () => {
    const lock = { workflowId: CUID, ticketKey: 'ACME-42' };
    expect(agentWorkflowId('ignored', lock)).toBe(`run-${CUID}-ACME-42`);
    expect(agentWorkflowId('ignored', lock, '')).toBe(`run-${CUID}-ACME-42`);
  });
});

describe('id builders — slugged output', () => {
  const slug = 'nightly-triage-acme-api';

  it('weaves the slug between the prefix and the cuid', () => {
    expect(workflowScheduleId(CUID, slug)).toBe(`poll-${slug}-${CUID}`);
    expect(pollWorkflowId(CUID, slug)).toBe(`poll-run-${slug}-${CUID}`);
    expect(cronWorkflowId(CUID, slug)).toBe(`cron-run-${slug}-${CUID}`);
  });

  it('weaves the slug into per-run agent ids', () => {
    expect(agentWorkflowId(CUID, undefined, slug)).toBe(`run-${slug}-${CUID}`);
  });

  it('weaves the slug into ticket-branch ids, keeping the ticketKey suffix', () => {
    const lock = { workflowId: CUID, ticketKey: 'ACME-42' };
    expect(agentWorkflowId('ignored', lock, slug)).toBe(`run-${slug}-${CUID}-ACME-42`);
  });

  it('keeps the cuid as the determinism anchor regardless of slug', () => {
    // Two different slugs over the same cuid still differ only by the cosmetic
    // prefix — the suffix that drives dedup is identical.
    const lock = { workflowId: CUID, ticketKey: 'ACME-42' };
    const a = agentWorkflowId('x', lock, 'slug-one');
    const b = agentWorkflowId('x', lock, 'slug-two');
    expect(a.endsWith(`-${CUID}-ACME-42`)).toBe(true);
    expect(b.endsWith(`-${CUID}-ACME-42`)).toBe(true);
  });
});
