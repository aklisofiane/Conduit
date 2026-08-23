import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { WebhooksService, type RawBodyRequest } from '../../src/modules/webhooks/webhooks.service';
import { encrypt } from '../../src/modules/credentials/crypto';
import { PrismaService } from '../../src/common/prisma.service';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Contract for `WebhooksService.handle` — the untrusted external entry point.
 * Exercises the full verify → normalize → match → dispatch state machine
 * against a real test Postgres: an encrypted HMAC secret is written onto
 * `Workflow.webhookSecret`, deliveries are fabricated as `RawBodyRequest`s
 * signed with GitHub's `sha256=<hex>` scheme, and `WorkflowsService.startRun`
 * is faked so we can assert exactly when (and with what) a run is dispatched.
 */
describe('WebhooksService.handle dispatch state machine', () => {
  const SECRET = 'top-secret-hmac-key';

  let prisma: PrismaClient;
  let svc: WebhooksService;
  let fixture: TwoOrgFixture;
  let startRunCalls: Array<{ orgId: string; workflowId: string; trigger: unknown }>;
  let startRunReturn: { id: string; workflowId: string } | null;
  let priorDevSecret: string | undefined;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    startRunCalls = [];
    startRunReturn = { id: 'run-123', workflowId: 'placeholder' };

    // The service caches `WEBHOOK_DEV_SECRET` at construction — clear it so a
    // header can never bypass HMAC verification via the dev backdoor.
    priorDevSecret = process.env.WEBHOOK_DEV_SECRET;
    delete process.env.WEBHOOK_DEV_SECRET;

    const fakeWorkflows = {
      startRun: async (orgId: string, workflowId: string, trigger: unknown) => {
        startRunCalls.push({ orgId, workflowId, trigger });
        return startRunReturn;
      },
    };
    svc = new WebhooksService(
      prisma as unknown as PrismaService,
      fakeWorkflows as unknown as WorkflowsService,
    );
  });

  afterEach(async () => {
    if (priorDevSecret === undefined) delete process.env.WEBHOOK_DEV_SECRET;
    else process.env.WEBHOOK_DEV_SECRET = priorDevSecret;
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  /** Insert a workflow for orgA with an optional github webhook trigger. */
  async function createWorkflow(opts: { active: boolean; configured: boolean }): Promise<string> {
    const triggers = opts.configured
      ? [
          {
            id: 'trg_webhook',
            name: 'webhook_trigger',
            platform: 'github',
            connectionId: 'conn_1',
            type: 'webhook',
            event: 'issues.opened',
            filters: [],
          },
        ]
      : [];
    const definition = {
      triggers,
      nodes: [],
      edges: [],
      mcpServers: [],
      ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
    };
    const wf = await prisma.workflow.create({
      data: {
        orgId: fixture.orgA.id,
        name: 'Webhook workflow',
        definition,
        isActive: opts.active,
        webhookSecret: encrypt(SECRET),
      },
    });
    return wf.id;
  }

  /** Build a GitHub `issues` webhook payload that normalizes to `issues.opened`. */
  function issuesOpenedPayload() {
    return {
      action: 'opened',
      repository: { owner: { login: 'orga' }, name: 'app' },
      sender: { login: 'octocat' },
      issue: {
        id: 4242,
        node_id: 'I_node_4242',
        number: 7,
        title: 'Something is broken',
        html_url: 'https://github.com/orga/app/issues/7',
        body: 'steps to reproduce',
      },
    };
  }

  /**
   * Fabricate a `RawBodyRequest` the way express + the signing client would:
   * the raw bytes are the exact `JSON.stringify` of the body, and (unless
   * overridden) the signature header is the HMAC over those bytes.
   */
  function githubRequest(opts: {
    event: string;
    payload: unknown;
    signWith?: string | null; // secret to sign with; null/undefined per flags below
    signature?: string; // explicit override
    omitSignature?: boolean;
  }): RawBodyRequest {
    const rawBody = Buffer.from(JSON.stringify(opts.payload), 'utf8');
    const headers: Record<string, string> = { 'x-github-event': opts.event };
    if (!opts.omitSignature) {
      headers['x-hub-signature-256'] =
        opts.signature ??
        `sha256=${createHmac('sha256', opts.signWith ?? SECRET)
          .update(rawBody)
          .digest('hex')}`;
    }
    return { rawBody, body: opts.payload, headers } as unknown as RawBodyRequest;
  }

  it('throws NotFound for an unknown workflowId', async () => {
    await expect(
      svc.handle(
        'wf_does_not_exist',
        githubRequest({ event: 'issues', payload: issuesOpenedPayload() }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(startRunCalls).toEqual([]);
  });

  it('throws Unauthorized when the workflow has no github/gitlab trigger', async () => {
    const id = await createWorkflow({ active: true, configured: false });
    await expect(
      svc.handle(id, githubRequest({ event: 'issues', payload: issuesOpenedPayload() })),
    ).rejects.toThrow(/not configured for webhook delivery/);
    await expect(
      svc.handle(id, githubRequest({ event: 'issues', payload: issuesOpenedPayload() })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(startRunCalls).toEqual([]);
  });

  it('throws Unauthorized for a wrong signature and never dispatches', async () => {
    const id = await createWorkflow({ active: true, configured: true });
    await expect(
      svc.handle(
        id,
        githubRequest({
          event: 'issues',
          payload: issuesOpenedPayload(),
          signWith: 'the-wrong-secret',
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(startRunCalls).toEqual([]);
  });

  it('throws Unauthorized for a missing signature header and never dispatches', async () => {
    const id = await createWorkflow({ active: true, configured: true });
    await expect(
      svc.handle(
        id,
        githubRequest({ event: 'issues', payload: issuesOpenedPayload(), omitSignature: true }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(startRunCalls).toEqual([]);
  });

  it('dispatches a correctly-signed issues.opened delivery on an ACTIVE workflow', async () => {
    const id = await createWorkflow({ active: true, configured: true });
    startRunReturn = { id: 'run-xyz', workflowId: id };

    const result = await svc.handle(
      id,
      githubRequest({ event: 'issues', payload: issuesOpenedPayload() }),
    );

    expect(result).toEqual({ status: 'started', runId: 'run-xyz' });
    expect(startRunCalls).toHaveLength(1);
    expect(startRunCalls[0]).toMatchObject({
      orgId: fixture.orgA.id,
      workflowId: id,
      trigger: {
        source: 'github',
        mode: 'webhook',
        event: 'issues.opened',
        issue: { key: '7', title: 'Something is broken' },
      },
    });
  });

  it('returns unsupported for a correctly-signed event we do not route', async () => {
    const id = await createWorkflow({ active: true, configured: true });
    // `issues` with action `labeled` is signed correctly but normalizes to null.
    const payload = { ...issuesOpenedPayload(), action: 'labeled' };

    const result = await svc.handle(id, githubRequest({ event: 'issues', payload }));

    expect(result).toEqual({ status: 'unsupported' });
    expect(startRunCalls).toEqual([]);
  });

  it('returns filtered for a matching delivery on an INACTIVE workflow', async () => {
    const id = await createWorkflow({ active: false, configured: true });

    const result = await svc.handle(
      id,
      githubRequest({ event: 'issues', payload: issuesOpenedPayload() }),
    );

    expect(result).toEqual({ status: 'filtered' });
    expect(startRunCalls).toEqual([]);
  });

  it('returns duplicate-dropped when startRun yields null (ticket-branch dedupe)', async () => {
    const id = await createWorkflow({ active: true, configured: true });
    startRunReturn = null;

    const result = await svc.handle(
      id,
      githubRequest({ event: 'issues', payload: issuesOpenedPayload() }),
    );

    expect(result).toEqual({ status: 'duplicate-dropped' });
    expect(startRunCalls).toHaveLength(1);
  });
});
