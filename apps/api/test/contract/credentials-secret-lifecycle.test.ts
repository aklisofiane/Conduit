import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { CredentialsService } from '../../src/modules/credentials/credentials.service';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Secret-handling business logic for `CredentialsService`. The cross-org
 * spec only proves 404/list-scoping; this one exercises the actual
 * credential-provenance machinery: AES round-trip + redaction, the
 * OAuth-row PAT-rotation strip, caller-metadata override, idempotent OAuth
 * upsert keyed on `accountRowId`, the delete-in-use Conflict, and the
 * server-trusted `decryptForConnection` lookup.
 */
describe('CredentialsService secret lifecycle', () => {
  let prisma: PrismaClient;
  let svc: CredentialsService;
  let fixture: TwoOrgFixture;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    svc = new CredentialsService(prisma as unknown as PrismaService);
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  const oauthParams = (
    overrides: Partial<Parameters<CredentialsService['upsertOAuthDerived']>[0]> = {},
  ) => ({
    orgId: fixture.orgA.id,
    accountRowId: 'acct_row_1',
    providerAccountId: '12345',
    providerLogin: 'octocat',
    accessToken: 'gho_initial_oauth_token',
    scopes: ['repo', 'read:org'],
    platform: 'GITHUB' as const,
    hostUrl: 'github.com',
    ...overrides,
  });

  it('round-trips the plaintext through create + decryptForOrgCredential, and list only exposes the redacted suffix', async () => {
    const plaintext = 'sk-ant-super-secret-token-7890';
    const created = await svc.create(fixture.orgA.id, {
      platform: 'GITHUB',
      name: 'round-trip cred',
      secret: plaintext,
    });

    const decrypted = await svc.decryptForOrgCredential(fixture.orgA.id, created.id);
    expect(decrypted).toBe(plaintext);

    // The persisted column is ciphertext, never the plaintext.
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.secret).not.toBe(plaintext);

    const listed = await svc.list(fixture.orgA.id);
    const mine = listed.find((c) => c.id === created.id);
    expect(mine).toBeDefined();
    expect(mine!.suffix).toBe('7890');
    // No field on the list row leaks the plaintext.
    expect(JSON.stringify(mine)).not.toContain(plaintext);
  });

  it('rotating the secret of an OAuth row (no caller metadata) strips source + scopes', async () => {
    const { id } = await svc.upsertOAuthDerived(oauthParams());

    await svc.update(fixture.orgA.id, id, { secret: 'ghp_manual_pat_replacement' });

    const row = await prisma.credential.findUniqueOrThrow({ where: { id } });
    const meta = row.metadata as Record<string, unknown> | null;
    expect(meta).not.toBeNull();
    expect(meta!.source).toBeUndefined();
    expect(meta!.scopes).toBeUndefined();
    // Non-provenance keys survive the strip.
    expect(meta!.accountRowId).toBe('acct_row_1');
    expect(meta!.providerLogin).toBe('octocat');

    // The new secret is what now decrypts out.
    expect(await svc.decryptForOrgCredential(fixture.orgA.id, id)).toBe(
      'ghp_manual_pat_replacement',
    );
  });

  it('rotating the secret WITH caller-supplied metadata keeps the caller metadata (no strip)', async () => {
    const { id } = await svc.upsertOAuthDerived(oauthParams());

    await svc.update(fixture.orgA.id, id, {
      secret: 'ghp_manual_pat_replacement',
      metadata: { source: 'oauth', scopes: ['repo'], note: 'caller wins' },
    });

    const row = await prisma.credential.findUniqueOrThrow({ where: { id } });
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.source).toBe('oauth');
    expect(meta.scopes).toEqual(['repo']);
    expect(meta.note).toBe('caller wins');
  });

  it('upsertOAuthDerived twice on the same accountRowId updates in place rather than duplicating', async () => {
    const first = await svc.upsertOAuthDerived(oauthParams());
    expect(first.created).toBe(true);

    const second = await svc.upsertOAuthDerived(
      oauthParams({
        accessToken: 'gho_rotated_oauth_token',
        scopes: ['repo', 'read:org', 'workflow'],
      }),
    );
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    // Exactly one OAuth row for this accountRowId.
    const rows = await prisma.credential.findMany({
      where: {
        orgId: fixture.orgA.id,
        platform: 'GITHUB',
        metadata: { path: ['accountRowId'], equals: 'acct_row_1' },
      },
    });
    expect(rows).toHaveLength(1);

    // The in-place update carried the rotated token + scopes.
    expect(await svc.decryptForOrgCredential(fixture.orgA.id, first.id)).toBe(
      'gho_rotated_oauth_token',
    );
    const meta = rows[0].metadata as Record<string, unknown>;
    expect(meta.scopes).toEqual(['repo', 'read:org', 'workflow']);
  });

  it('delete on a credential referenced by a connection throws Conflict and leaves the row intact', async () => {
    // The fixture wires orgA.connectionId -> orgA.credentialId.
    await expect(svc.delete(fixture.orgA.id, fixture.orgA.credentialId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const stillThere = await prisma.credential.findUnique({
      where: { id: fixture.orgA.credentialId },
    });
    expect(stillThere).not.toBeNull();
  });

  it('decryptForConnection returns plaintext for a real connection id and undefined for an unknown one', async () => {
    const plaintext = 'gho_connection_bound_token';
    const cred = await svc.create(fixture.orgA.id, {
      platform: 'GITHUB',
      name: 'connection cred',
      secret: plaintext,
    });
    const conn = await prisma.connection.create({
      data: {
        orgId: fixture.orgA.id,
        credentialId: cred.id,
        name: 'bound conn',
        scope: { kind: 'github_repo', owner: 'orga', repo: 'svc' },
      },
    });

    expect(await svc.decryptForConnection(conn.id)).toBe(plaintext);
    expect(await svc.decryptForConnection('conn_does_not_exist')).toBeUndefined();
  });
});
