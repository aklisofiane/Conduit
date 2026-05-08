import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadEventFixture, loadWorkflowFixture } from '../helpers/temporal';
import { deliverGithubWebhook } from '../helpers/webhook';
import { startHarness, type Harness, type HttpClient } from './harness';

/**
 * authorization-enforcement E2E. Two orgs, one webhook delivery into Org A,
 * and a battery of cross-org probes against the resulting `runId` and
 * Socket.IO room. None of them should leak whether the run exists or
 * deliver any frames cross-org. An anonymous Socket.IO connect should also
 * be rejected.
 */

const WEBHOOK_SECRET = 'authz-enforcement-secret';

describe('authorization enforcement: socket auth + webhook->run org chain', () => {
  let harness: Harness;
  let orgA: HttpClient;
  let orgACookie: string;
  let orgBCookie: string;
  let runId: string;
  let workflowAId: string;

  beforeAll(async () => {
    harness = await startHarness();
    orgA = harness.http;
    orgACookie = harness.authCookie;

    const second = await harness.createSecondOrg();
    orgBCookie = second.authCookie;

    await harness.seedTicketBranchRepo('acme', 'authz-tests');

    const cred = await orgA.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'authz-pat',
      secret: 'ghp_stub_token_for_tests',
    });
    const fixture = await loadWorkflowFixture('phase2-webhook-issue');
    const created = await orgA.post<{ id: string; definition: WorkflowDefinition }>(
      '/workflows',
      {
        name: fixture.name,
        description: fixture.description,
        definition: fixture.definition,
      },
    );
    workflowAId = created.id;
    const connection = await orgA.post<{ id: string }>('/connections', {
      name: 'acme/authz-tests',
      credentialId: cred.id,
      scope: { kind: 'github_repo', owner: 'acme', repo: 'authz-tests' },
    });
    const patched: WorkflowDefinition = {
      ...created.definition,
      triggers: created.definition.triggers.map((t) => ({
        ...t,
        connectionId: connection.id,
      })),
    };
    await orgA.put(`/workflows/${created.id}`, {
      definition: patched,
      isActive: true,
    });
    await orgA.put(`/workflows/${created.id}/webhook-secret`, { secret: WEBHOOK_SECRET });
    await harness.setStubScript({ steps: [{ kind: 'done' }] });

    const payload = await loadEventFixture('github', 'issues.opened');
    const delivery = await deliverGithubWebhook(harness, created.id, {
      event: 'issues',
      deliveryId: 'authz-test-1',
      secret: WEBHOOK_SECRET,
      payload,
    });
    runId = delivery.runId;
  }, 240_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("orgA webhook produced a run; orgB cannot read it via REST (404)", async () => {
    // OrgA can read its own run.
    const ownRun = await orgA.get<{ id: string }>(`/runs/${runId}`);
    expect(ownRun.id).toBe(runId);

    // OrgB GETs the runId — service-layer org filter → 404, not 403.
    const res = await fetch(`${harness.apiUrl}/api/runs/${runId}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json', cookie: orgBCookie },
    });
    expect(res.status).toBe(404);
  });

  it("orgA cannot list orgB workflow runs (orgA's workflowId leaks nothing cross-org)", async () => {
    // Sanity: orgA's own workflow→runs returns its own run.
    const own = await orgA.get<Array<{ id: string }>>(`/workflows/${workflowAId}/runs`);
    expect(own.map((r) => r.id)).toContain(runId);
    // OrgB asking about orgA's workflow id sees an empty list.
    const res = await fetch(
      `${harness.apiUrl}/api/workflows/${workflowAId}/runs`,
      {
        method: 'GET',
        headers: { 'content-type': 'application/json', cookie: orgBCookie },
      },
    );
    // Cross-org workflow id → 404 (service findFirst by workflowId+orgId → null).
    // The list endpoint may return [] or 404 depending on implementation; both
    // satisfy "no leak". Pin to whichever is current.
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as Array<{ id: string }>;
      expect(body).toEqual([]);
    }
  });

  it("orgA's session can connect to its own runId WS room", async () => {
    const probe = harness.connectSocket(runId, { cookie: orgACookie });
    try {
      await probe.waitForConnect(5_000);
    } finally {
      probe.close();
    }
  });

  it("orgB's session connecting to orgA's runId is disconnected, no frames", async () => {
    const probe = harness.connectSocket(runId, { cookie: orgBCookie });
    try {
      // The server may complete the upgrade and then disconnect, or refuse
      // upgrade outright with a `connect_error` — both prove rejection.
      const reason = await probe.waitForDisconnect(10_000);
      expect(reason).toBeDefined();
      expect(probe.framesReceived()).toEqual([]);
    } finally {
      probe.close();
    }
  });

  it('anonymous (no cookie) Socket.IO connect to /runs is disconnected', async () => {
    const probe = harness.connectSocket(runId);
    try {
      const reason = await probe.waitForDisconnect(10_000);
      expect(reason).toBeDefined();
      expect(probe.framesReceived()).toEqual([]);
    } finally {
      probe.close();
    }
  });
});
