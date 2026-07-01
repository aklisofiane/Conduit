import { describe, expect, it, vi } from 'vitest';
import {
  createOrganizationGuardHooks,
  isLastOrganization,
  type OrgMembershipCounter,
} from './org-guard-hooks';

describe('isLastOrganization', () => {
  it('treats 0 and 1 memberships as the last org', () => {
    expect(isLastOrganization(0)).toBe(true);
    expect(isLastOrganization(1)).toBe(true);
  });

  it('allows deletion when the user belongs to 2+ orgs', () => {
    expect(isLastOrganization(2)).toBe(false);
    expect(isLastOrganization(5)).toBe(false);
  });
});

describe('createOrganizationGuardHooks.beforeDeleteOrganization', () => {
  function makeHook(count: number) {
    const db: OrgMembershipCounter = {
      member: { count: vi.fn().mockResolvedValue(count) },
    };
    const hooks = createOrganizationGuardHooks(db);
    return { hook: hooks.beforeDeleteOrganization!, db };
  }

  const args = {
    organization: { id: 'org-1' },
    user: { id: 'u-1' },
  } as never;

  it('blocks deleting the last org (throws)', async () => {
    const { hook, db } = makeHook(1);
    await expect(hook(args)).rejects.toThrow(/at least one organization/i);
    expect(db.member.count).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
  });

  it('allows deletion when another org remains', async () => {
    const { hook } = makeHook(2);
    await expect(hook(args)).resolves.toBeUndefined();
  });
});
