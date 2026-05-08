import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type HttpClient } from './harness';

/**
 * End-to-end cross-org rejection spec. Two users sign up against the same
 * api process; the signup-shim gives each their own `Organization`. Org A
 * cannot see / mutate Org B's workflows, runs, credentials, or
 * connections through any API surface.
 *
 * Validates that `@OrgId()` on every guarded controller forwards the
 * caller's `activeOrganizationId` to the service layer, and that every
 * service applies it to `where` / `data` clauses (404, never 403).
 */
describe('cross-org isolation', () => {
  let harness: Harness;
  let orgA: HttpClient;
  let orgB: HttpClient;
  let orgACookie: string;
  let workflowAId: string;
  let workflowBId: string;
  let credentialAId: string;
  let credentialBId: string;
  let connectionAId: string;
  let connectionBId: string;

  beforeAll(async () => {
    harness = await startHarness();
    orgA = harness.http;
    orgACookie = harness.authCookie;
    const second = await harness.createSecondOrg();
    orgB = second.http;

    const wfA = await orgA.post<{ id: string }>('/workflows', { name: 'org-a-wf' });
    workflowAId = wfA.id;
    const wfB = await orgB.post<{ id: string }>('/workflows', { name: 'org-b-wf' });
    workflowBId = wfB.id;

    const credA = await orgA.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'org-a-cred',
      secret: 'tok-a',
    });
    credentialAId = credA.id;
    const credB = await orgB.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'org-b-cred',
      secret: 'tok-b',
    });
    credentialBId = credB.id;

    const connA = await orgA.post<{ id: string }>('/connections', {
      credentialId: credentialAId,
      name: 'org-a-conn',
      scope: { kind: 'github_repo', owner: 'orga', repo: 'app' },
    });
    connectionAId = connA.id;
    const connB = await orgB.post<{ id: string }>('/connections', {
      credentialId: credentialBId,
      name: 'org-b-conn',
      scope: { kind: 'github_repo', owner: 'orgb', repo: 'app' },
    });
    connectionBId = connB.id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it('orgA workflow list does not contain orgB workflows', async () => {
    const list = await orgA.get<Array<{ id: string }>>('/workflows');
    expect(list.map((w) => w.id)).toContain(workflowAId);
    expect(list.map((w) => w.id)).not.toContain(workflowBId);
  });

  it('orgA cannot read orgB workflow detail (404, not 403)', async () => {
    await expectStatus(harness, orgACookie, `/workflows/${workflowBId}`, 'GET', 404);
  });

  it('orgA cannot list orgB workflow runs (returns empty list)', async () => {
    const runs = await orgA.get<unknown[]>(`/workflows/${workflowBId}/runs`);
    expect(runs).toEqual([]);
  });

  it('orgA credential list does not contain orgB credentials', async () => {
    const list = await orgA.get<Array<{ id: string }>>('/credentials');
    expect(list.map((c) => c.id)).toContain(credentialAId);
    expect(list.map((c) => c.id)).not.toContain(credentialBId);
  });

  it('orgA connection list does not contain orgB connections', async () => {
    const list = await orgA.get<Array<{ id: string }>>('/connections');
    expect(list.map((c) => c.id)).toContain(connectionAId);
    expect(list.map((c) => c.id)).not.toContain(connectionBId);
  });

  it("orgA cannot create a Connection bound to orgB's credentialId (404)", async () => {
    await expectStatus(harness, orgACookie, '/connections', 'POST', 404, {
      credentialId: credentialBId,
      name: 'hijack',
      scope: { kind: 'github_repo', owner: 'orga', repo: 'app' },
    });
  });

  it('orgA cannot delete orgB workflow (404)', async () => {
    await expectStatus(harness, orgACookie, `/workflows/${workflowBId}`, 'DELETE', 404);
  });
});

/**
 * Lightweight raw-fetch helper that asserts an exact HTTP status. Avoids the
 * `HttpClient.del/get/post` throw-on-non-2xx behavior so we can pin 404 vs.
 * 403 (the spec's cross-org → 404 contract).
 */
async function expectStatus(
  harness: Harness,
  cookie: string,
  pathSuffix: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  expected: number,
  body?: unknown,
): Promise<void> {
  const res = await fetch(`${harness.apiUrl}/api${pathSuffix}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status, `${method} ${pathSuffix} expected ${expected}, body=${await res.text()}`).toBe(
    expected,
  );
}

