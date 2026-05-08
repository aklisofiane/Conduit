import type { PrismaClient } from '@conduit/database';

/**
 * Canonical "two orgs, two workflows" fixture used by every cross-org
 * integration test in `apps/api/test/contract/`.
 *
 * Seeds:
 *   - Two organizations + a sentinel `User` row each plugin-table FK can hang
 *     off of (Better Auth's user/session tables are not exercised here — we
 *     only need the `organization` rows that tenant-scoped models FK into).
 *   - Two `Workflow` rows, one per org, with a minimal definition.
 *   - Two `Credential` rows, one per org.
 *   - Two `Connection` rows, each pointing at its own-org credential.
 *   - Two `WorkflowRun` rows, one per workflow, with a single matching
 *     `ExecutionLog` and `NodeRun` so the cross-org listForWorkflow / logs
 *     tests have something to filter.
 *
 * Every row carries an explicit `orgId`. Same-org invariant (Connection's
 * orgId == Credential's orgId, etc.) is satisfied by construction.
 */
export interface TwoOrgFixture {
  orgA: { id: string; workflowId: string; credentialId: string; connectionId: string; runId: string };
  orgB: { id: string; workflowId: string; credentialId: string; connectionId: string; runId: string };
}

export async function seedTwoOrgs(prisma: PrismaClient): Promise<TwoOrgFixture> {
  const orgA = await prisma.organization.create({
    data: {
      id: `org_a_${unique()}`,
      name: 'Org A',
      slug: `org-a-${unique()}`,
      createdAt: new Date(),
    },
  });
  const orgB = await prisma.organization.create({
    data: {
      id: `org_b_${unique()}`,
      name: 'Org B',
      slug: `org-b-${unique()}`,
      createdAt: new Date(),
    },
  });

  const credA = await prisma.credential.create({
    data: {
      orgId: orgA.id,
      platform: 'GITHUB',
      name: 'A creds',
      // Encrypted-at-rest column; the cross-org tests never decrypt it, so
      // a literal placeholder is fine — it never reaches the crypto layer.
      secret: 'placeholder-ciphertext',
    },
  });
  const credB = await prisma.credential.create({
    data: {
      orgId: orgB.id,
      platform: 'GITHUB',
      name: 'B creds',
      secret: 'placeholder-ciphertext',
    },
  });

  const connA = await prisma.connection.create({
    data: {
      orgId: orgA.id,
      credentialId: credA.id,
      name: 'A repo',
      scope: { kind: 'github_repo', owner: 'orga', repo: 'app' },
    },
  });
  const connB = await prisma.connection.create({
    data: {
      orgId: orgB.id,
      credentialId: credB.id,
      name: 'B repo',
      scope: { kind: 'github_repo', owner: 'orgb', repo: 'app' },
    },
  });

  const definition = {
    triggers: [],
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  };
  const workflowA = await prisma.workflow.create({
    data: { orgId: orgA.id, name: 'A workflow', definition, isActive: false },
  });
  const workflowB = await prisma.workflow.create({
    data: { orgId: orgB.id, name: 'B workflow', definition, isActive: false },
  });

  const runA = await prisma.workflowRun.create({
    data: {
      orgId: orgA.id,
      workflowId: workflowA.id,
      status: 'COMPLETED',
      trigger: { source: 'github', kind: 'issue' },
      finishedAt: new Date(),
    },
  });
  const runB = await prisma.workflowRun.create({
    data: {
      orgId: orgB.id,
      workflowId: workflowB.id,
      status: 'COMPLETED',
      trigger: { source: 'github', kind: 'issue' },
      finishedAt: new Date(),
    },
  });

  await prisma.executionLog.create({
    data: {
      orgId: orgA.id,
      runId: runA.id,
      kind: 'SYSTEM',
      payload: { message: 'A log line' },
    },
  });
  await prisma.executionLog.create({
    data: {
      orgId: orgB.id,
      runId: runB.id,
      kind: 'SYSTEM',
      payload: { message: 'B log line' },
    },
  });

  return {
    orgA: {
      id: orgA.id,
      workflowId: workflowA.id,
      credentialId: credA.id,
      connectionId: connA.id,
      runId: runA.id,
    },
    orgB: {
      id: orgB.id,
      workflowId: workflowB.id,
      credentialId: credB.id,
      connectionId: connB.id,
      runId: runB.id,
    },
  };
}

let counter = 0;
function unique(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${process.pid}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}
