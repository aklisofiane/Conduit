import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@conduit/database';
import { CredentialsService } from '../../src/modules/credentials/credentials.service';
import { PrismaService } from '../../src/common/prisma.service';
import { decrypt } from '../../src/modules/credentials/crypto';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Contract for the OAuth-derived credential mirror (`upsertOAuthDerived`)
 * and PAT-rotation conversion behavior in `update`. Both are entry points
 * exercised by Better Auth's `account.create.after` hook and the existing
 * Settings UI rotate flow.
 */
describe('CredentialsService OAuth mirror', () => {
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

  it('creates a GITHUB credential with oauth-source metadata on first call', async () => {
    const result = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_1',
      providerAccountId: '12345',
      providerLogin: 'octocat',
      accessToken: 'gho_token_v1',
      scopes: ['repo', 'project', 'read:org'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });
    expect(result.created).toBe(true);

    const row = await prisma.credential.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.orgId).toBe(fixture.orgA.id);
    expect(row.platform).toBe('GITHUB');
    expect(row.name).toBe('octocat (oauth)');
    expect(row.hostUrl).toBe('github.com');
    expect(decrypt(row.secret)).toBe('gho_token_v1');
    expect(row.metadata).toEqual({
      source: 'oauth',
      accountRowId: 'acct_row_1',
      providerAccountId: '12345',
      providerLogin: 'octocat',
      scopes: ['repo', 'project', 'read:org'],
    });
  });

  it('creates a GITLAB credential with correct platform and hostUrl', async () => {
    const result = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_gl_1',
      providerAccountId: '67890',
      providerLogin: 'gl-user',
      accessToken: 'glpat_token_v1',
      scopes: ['api', 'read_user'],
      platform: 'GITLAB',
      hostUrl: 'gitlab.com',
    });
    expect(result.created).toBe(true);

    const row = await prisma.credential.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.orgId).toBe(fixture.orgA.id);
    expect(row.platform).toBe('GITLAB');
    expect(row.name).toBe('gl-user (oauth)');
    expect(row.hostUrl).toBe('gitlab.com');
    expect(decrypt(row.secret)).toBe('glpat_token_v1');
    expect(row.metadata).toEqual({
      source: 'oauth',
      accountRowId: 'acct_row_gl_1',
      providerAccountId: '67890',
      providerLogin: 'gl-user',
      scopes: ['api', 'read_user'],
    });
  });

  it('creates separate Credential rows for github and gitlab under the same user', async () => {
    const gh = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_gh_multi',
      providerAccountId: '111',
      providerLogin: 'multi-user',
      accessToken: 'gho_token',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });
    const gl = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_gl_multi',
      providerAccountId: '222',
      providerLogin: 'multi-user',
      accessToken: 'glpat_token',
      scopes: ['api'],
      platform: 'GITLAB',
      hostUrl: 'gitlab.com',
    });
    expect(gh.created).toBe(true);
    expect(gl.created).toBe(true);
    expect(gh.id).not.toBe(gl.id);

    const ghRow = await prisma.credential.findUniqueOrThrow({ where: { id: gh.id } });
    const glRow = await prisma.credential.findUniqueOrThrow({ where: { id: gl.id } });
    expect(ghRow.platform).toBe('GITHUB');
    expect(glRow.platform).toBe('GITLAB');
  });

  it('updates secret and scopes in place on re-authorization (same accountRowId)', async () => {
    const first = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_2',
      providerAccountId: '12345',
      providerLogin: 'octocat',
      accessToken: 'gho_token_v1',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });
    const second = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_2',
      providerAccountId: '12345',
      providerLogin: 'octocat',
      accessToken: 'gho_token_v2',
      scopes: ['repo', 'project', 'read:org'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const row = await prisma.credential.findUniqueOrThrow({ where: { id: first.id } });
    expect(decrypt(row.secret)).toBe('gho_token_v2');
    expect((row.metadata as Record<string, unknown>).scopes).toEqual([
      'repo',
      'project',
      'read:org',
    ]);
  });

  it('PAT-rotation on an oauth-derived row clears metadata.source and metadata.scopes', async () => {
    const { id } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_3',
      providerAccountId: '99',
      providerLogin: 'gh-user',
      accessToken: 'gho_oauth_token',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });

    await svc.update(fixture.orgA.id, id, { secret: 'ghp_manual_pat' });

    const row = await prisma.credential.findUniqueOrThrow({ where: { id } });
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.source).toBeUndefined();
    expect(meta.scopes).toBeUndefined();
    // Identity fields are kept so a future re-OAuth still finds the row.
    expect(meta.accountRowId).toBe('acct_row_3');
    expect(meta.providerLogin).toBe('gh-user');
    expect(decrypt(row.secret)).toBe('ghp_manual_pat');
  });

  it('re-mirroring under a different active org keeps the credential in its original org', async () => {
    // First mirror lands in orgA (the org that was active when the account
    // was linked). A later re-mirror — refresh, or re-auth while another org
    // is active — must update in place, not move or duplicate the row.
    const first = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_org_move',
      providerAccountId: '777',
      providerLogin: 'octocat',
      accessToken: 'gho_token_v1',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });
    const second = await svc.upsertOAuthDerived({
      orgId: fixture.orgB.id,
      accountRowId: 'acct_row_org_move',
      providerAccountId: '777',
      providerLogin: 'octocat',
      accessToken: 'gho_token_v2',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const row = await prisma.credential.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.orgId).toBe(fixture.orgA.id);
    expect(decrypt(row.secret)).toBe('gho_token_v2');

    const all = await prisma.credential.findMany({
      where: { metadata: { path: ['accountRowId'], equals: 'acct_row_org_move' } },
    });
    expect(all).toHaveLength(1);
  });

  it('records metadata.tokenExpiresAt as an ISO string when the provider expires the token', async () => {
    const expiresAt = new Date('2026-03-04T05:06:07.000Z');
    const { id } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_expiry',
      providerAccountId: '4242',
      providerLogin: 'gl-user',
      accessToken: 'gl_access_v1',
      scopes: ['api', 'read_user'],
      platform: 'GITLAB',
      hostUrl: 'gitlab.com',
      tokenExpiresAt: expiresAt,
    });

    const row = await prisma.credential.findUniqueOrThrow({ where: { id } });
    expect((row.metadata as Record<string, unknown>).tokenExpiresAt).toBe(expiresAt.toISOString());

    // A refresh moves the expiry forward in place.
    const later = new Date('2026-03-04T07:06:07.000Z');
    await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_expiry',
      providerAccountId: '4242',
      providerLogin: 'gl-user',
      accessToken: 'gl_access_v2',
      scopes: ['api', 'read_user'],
      platform: 'GITLAB',
      hostUrl: 'gitlab.com',
      tokenExpiresAt: later.toISOString(),
    });
    const refreshed = await prisma.credential.findUniqueOrThrow({ where: { id } });
    expect((refreshed.metadata as Record<string, unknown>).tokenExpiresAt).toBe(
      later.toISOString(),
    );
    expect(decrypt(refreshed.secret)).toBe('gl_access_v2');
  });

  it('omits metadata.tokenExpiresAt for a non-expiring token (GitHub, expiration off)', async () => {
    const { id } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_no_expiry',
      providerAccountId: '4243',
      providerLogin: 'octocat',
      accessToken: 'gho_forever',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
      tokenExpiresAt: null,
    });

    const row = await prisma.credential.findUniqueOrThrow({ where: { id } });
    expect((row.metadata as Record<string, unknown>).tokenExpiresAt).toBeUndefined();
  });

  it('PAT-rotation drops metadata.tokenExpiresAt along with the oauth provenance', async () => {
    const { id } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_expiry_rotate',
      providerAccountId: '4244',
      providerLogin: 'gl-user',
      accessToken: 'gl_access_v1',
      scopes: ['api'],
      platform: 'GITLAB',
      hostUrl: 'gitlab.com',
      tokenExpiresAt: new Date('2026-03-04T05:06:07.000Z'),
    });

    await svc.update(fixture.orgA.id, id, { secret: 'glpat_manual' });

    const meta = (await prisma.credential.findUniqueOrThrow({ where: { id } }))
      .metadata as Record<string, unknown>;
    expect(meta.tokenExpiresAt).toBeUndefined();
    expect(meta.source).toBeUndefined();
    expect(meta.accountRowId).toBe('acct_row_expiry_rotate');
  });

  it('findOAuthDerivedByAccountRow resolves the mirrored row and its dependent connections', async () => {
    const { id } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_lookup',
      providerAccountId: '555',
      providerLogin: 'octocat',
      accessToken: 'gho_lookup',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });
    await prisma.connection.create({
      data: {
        orgId: fixture.orgA.id,
        credentialId: id,
        name: 'linked repo',
        scope: { kind: 'github_repo', owner: 'orga', repo: 'linked' },
      },
    });

    const found = await svc.findOAuthDerivedByAccountRow('acct_row_lookup');
    expect(found).toEqual({
      id,
      orgId: fixture.orgA.id,
      name: 'octocat (oauth)',
      dependentConnections: ['linked repo'],
    });
    expect(await svc.findOAuthDerivedByAccountRow('acct_row_unknown')).toBeNull();
  });

  it('deleteOAuthDerivedByAccountRow removes an unreferenced mirrored credential (unlink cleanup)', async () => {
    const { id } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_unlink',
      providerAccountId: '888',
      providerLogin: 'octocat',
      accessToken: 'gho_unlink',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });

    const result = await svc.deleteOAuthDerivedByAccountRow('acct_row_unlink');
    expect(result.status).toBe('deleted');
    expect(await prisma.credential.findUnique({ where: { id } })).toBeNull();
  });

  it('deleteOAuthDerivedByAccountRow refuses while a connection references the credential', async () => {
    const { id } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_unlink_blocked',
      providerAccountId: '999',
      providerLogin: 'octocat',
      accessToken: 'gho_blocked',
      scopes: ['repo'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });
    await prisma.connection.create({
      data: {
        orgId: fixture.orgA.id,
        credentialId: id,
        name: 'blocking repo',
        scope: { kind: 'github_repo', owner: 'orga', repo: 'blocking' },
      },
    });

    const result = await svc.deleteOAuthDerivedByAccountRow('acct_row_unlink_blocked');
    expect(result.status).toBe('referenced');
    expect(result.dependentConnections).toEqual(['blocking repo']);
    expect(await prisma.credential.findUnique({ where: { id } })).not.toBeNull();
  });

  it('deleteOAuthDerivedByAccountRow reports not-found for an account that was never mirrored', async () => {
    const result = await svc.deleteOAuthDerivedByAccountRow('acct_row_never_mirrored');
    expect(result.status).toBe('not-found');
  });

  it('update without a new secret leaves oauth metadata untouched', async () => {
    const { id } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId: 'acct_row_4',
      providerAccountId: '42',
      providerLogin: 'someone',
      accessToken: 'gho_keep_me',
      scopes: ['repo', 'project'],
      platform: 'GITHUB',
      hostUrl: 'github.com',
    });

    await svc.update(fixture.orgA.id, id, { name: 'renamed' });

    const row = await prisma.credential.findUniqueOrThrow({ where: { id } });
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.source).toBe('oauth');
    expect(meta.scopes).toEqual(['repo', 'project']);
    expect(row.name).toBe('renamed');
  });
});
