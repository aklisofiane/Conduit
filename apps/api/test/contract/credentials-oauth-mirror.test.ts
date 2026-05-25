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
