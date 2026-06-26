import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { ProviderConfigsService } from '../../src/modules/provider-configs/provider-configs.service';
import { decrypt, encrypt } from '../../src/modules/credentials/crypto';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Upsert + encryption-roundtrip contract for `ProviderConfigsService`. Mirrors
 * `provider-configs-cross-org` but focuses on the `(orgId, providerId)`
 * composite-key dedup semantics and the never-leak-plaintext suffix redaction:
 *   - re-POSTing the same providerId replaces in place (one row, same id),
 *   - the apiKey lands encrypted at rest and only a 4-char suffix is exposed,
 *   - distinct providerIds coexist as separate rows,
 *   - partial updates leave the encrypted key untouched.
 * Cross-org scoping is re-asserted as a sanity check that the new file still
 * respects tenant isolation.
 */
describe('ProviderConfigsService upsert + encryption roundtrip', () => {
  let prisma: PrismaClient;
  let svc: ProviderConfigsService;
  let fixture: TwoOrgFixture;
  let orgARowId: string;
  let orgBRowId: string;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    await prisma.providerConfig.deleteMany({});
    fixture = await seedTwoOrgs(prisma);
    svc = new ProviderConfigsService(prisma as unknown as PrismaService);

    const a = await prisma.providerConfig.create({
      data: {
        orgId: fixture.orgA.id,
        providerId: 'claude',
        encryptedApiKey: encrypt('sk-ant-org-a-1234'),
        baseUrl: 'https://proxy.a.example/v1',
      },
    });
    const b = await prisma.providerConfig.create({
      data: {
        orgId: fixture.orgB.id,
        providerId: 'claude',
        encryptedApiKey: encrypt('sk-ant-org-b-5678'),
      },
    });
    orgARowId = a.id;
    orgBRowId = b.id;
  });

  afterEach(async () => {
    await prisma.providerConfig.deleteMany({});
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('create twice for the same providerId yields a single row updated in place', async () => {
    const replaced = await svc.create(fixture.orgA.id, {
      providerId: 'claude',
      apiKey: 'sk-ant-rotated-9999',
      baseUrl: 'https://litellm.example/v1',
    });
    // Same composite key -> same row id, no insert.
    expect(replaced.id).toBe(orgARowId);
    expect(replaced.suffix).toBe('9999');
    expect(replaced.baseUrl).toBe('https://litellm.example/v1');

    const rows = await prisma.providerConfig.findMany({
      where: { orgId: fixture.orgA.id, providerId: 'claude' },
    });
    expect(rows).toHaveLength(1);
    // The second call replaced both key and baseUrl at rest.
    expect(decrypt(rows[0].encryptedApiKey)).toBe('sk-ant-rotated-9999');
    expect(rows[0].baseUrl).toBe('https://litellm.example/v1');
  });

  it('create persists the apiKey encrypted and exposes only a 4-char suffix, never the key', async () => {
    const created = await svc.create(fixture.orgA.id, {
      providerId: 'codex',
      apiKey: 'sk-codex-secret-abcd',
    });

    // Returned row carries only the redacted display hint.
    expect(created.suffix).toBe('abcd');
    expect(Object.keys(created)).not.toContain('apiKey');
    expect(Object.keys(created)).not.toContain('encryptedApiKey');
    expect(JSON.stringify(created)).not.toContain('sk-codex-secret-abcd');

    // At rest the column is ciphertext, not the plaintext, and round-trips.
    const row = await prisma.providerConfig.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.encryptedApiKey).not.toContain('sk-codex-secret-abcd');
    expect(decrypt(row.encryptedApiKey)).toBe('sk-codex-secret-abcd');
  });

  it('create for two distinct providerIds in one org yields two rows', async () => {
    await svc.create(fixture.orgA.id, {
      providerId: 'codex',
      apiKey: 'sk-codex-0001',
    });

    const rows = await prisma.providerConfig.findMany({
      where: { orgId: fixture.orgA.id },
    });
    expect(rows.map((r) => r.providerId).sort()).toEqual(['claude', 'codex']);
    expect(rows).toHaveLength(2);
  });

  it('update with only baseUrl leaves the encrypted key untouched', async () => {
    const before = await prisma.providerConfig.findUniqueOrThrow({
      where: { id: orgARowId },
    });

    const updated = await svc.update(fixture.orgA.id, orgARowId, {
      baseUrl: 'https://moved.a.example/v1',
    });
    expect(updated.baseUrl).toBe('https://moved.a.example/v1');
    // Suffix derives from the still-original key.
    expect(updated.suffix).toBe('1234');

    const after = await prisma.providerConfig.findUniqueOrThrow({
      where: { id: orgARowId },
    });
    expect(after.encryptedApiKey).toBe(before.encryptedApiKey);
  });

  it('update with apiKey undefined and baseUrl:null clears baseUrl without touching the key', async () => {
    const before = await prisma.providerConfig.findUniqueOrThrow({
      where: { id: orgARowId },
    });

    const updated = await svc.update(fixture.orgA.id, orgARowId, {
      baseUrl: null,
    });
    expect(updated.baseUrl).toBeNull();
    expect(updated.suffix).toBe('1234');

    const after = await prisma.providerConfig.findUniqueOrThrow({
      where: { id: orgARowId },
    });
    expect(after.baseUrl).toBeNull();
    expect(after.encryptedApiKey).toBe(before.encryptedApiKey);
  });

  it('update on a sibling-org id throws NotFoundException', async () => {
    await expect(
      svc.update(fixture.orgA.id, orgBRowId, { apiKey: 'hijack' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const row = await prisma.providerConfig.findUniqueOrThrow({
      where: { id: orgBRowId },
    });
    expect(row.encryptedApiKey).not.toContain('hijack');
    expect(decrypt(row.encryptedApiKey)).toBe('sk-ant-org-b-5678');
  });
});
