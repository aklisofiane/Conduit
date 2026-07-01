import { describe, expect, it, vi } from 'vitest';
import {
  canDeleteOrganization,
  canManageMember,
  isSoleOwner,
  submitInvite,
  type InviteValues,
} from './OrganizationSettingsPage.js';
import type { OrganizationMember } from '../api/organization.js';

function member(overrides: Partial<OrganizationMember>): OrganizationMember {
  return {
    id: overrides.id ?? 'm-' + Math.random().toString(36).slice(2, 8),
    organizationId: 'org-1',
    userId: overrides.userId ?? 'u-1',
    role: overrides.role ?? 'member',
    createdAt: '2026-05-01T00:00:00Z',
    user: {
      id: overrides.userId ?? 'u-1',
      email: 'a@example.com',
      name: 'Alice',
    },
    ...overrides,
  };
}

describe('canManageMember', () => {
  it('owner can manage everyone including other owners', () => {
    expect(canManageMember('owner', 'owner')).toBe(true);
    expect(canManageMember('owner', 'admin')).toBe(true);
    expect(canManageMember('owner', 'member')).toBe(true);
  });

  it('admin can manage non-owners', () => {
    expect(canManageMember('admin', 'admin')).toBe(true);
    expect(canManageMember('admin', 'member')).toBe(true);
  });

  it('admin cannot manage owners', () => {
    expect(canManageMember('admin', 'owner')).toBe(false);
  });

  it('member cannot manage anyone', () => {
    expect(canManageMember('member', 'member')).toBe(false);
    expect(canManageMember('member', 'admin')).toBe(false);
    expect(canManageMember('member', 'owner')).toBe(false);
  });

  it('returns false for missing actor role', () => {
    expect(canManageMember(undefined, 'member')).toBe(false);
  });
});

describe('isSoleOwner', () => {
  it('returns true when user is the only owner of an org with members', () => {
    const members = [
      member({ id: 'm1', userId: 'u-1', role: 'owner' }),
      member({ id: 'm2', userId: 'u-2', role: 'member' }),
    ];
    expect(isSoleOwner({ members, userId: 'u-1' })).toBe(true);
  });

  it('returns false when there are multiple owners', () => {
    const members = [
      member({ id: 'm1', userId: 'u-1', role: 'owner' }),
      member({ id: 'm2', userId: 'u-2', role: 'owner' }),
    ];
    expect(isSoleOwner({ members, userId: 'u-1' })).toBe(false);
  });

  it('returns false for an org with only one member (the user is alone)', () => {
    const members = [member({ id: 'm1', userId: 'u-1', role: 'owner' })];
    expect(isSoleOwner({ members, userId: 'u-1' })).toBe(false);
  });

  it('returns false when user is not an owner', () => {
    const members = [
      member({ id: 'm1', userId: 'u-1', role: 'owner' }),
      member({ id: 'm2', userId: 'u-2', role: 'member' }),
    ];
    expect(isSoleOwner({ members, userId: 'u-2' })).toBe(false);
  });

  it('returns false when userId is undefined', () => {
    const members = [member({ id: 'm1', userId: 'u-1', role: 'owner' })];
    expect(isSoleOwner({ members, userId: undefined })).toBe(false);
  });
});

describe('canDeleteOrganization', () => {
  it('lets an owner delete when they have another org to fall back to', () => {
    expect(canDeleteOrganization({ myRole: 'owner', orgCount: 2 })).toBe(true);
  });

  it('blocks deleting the only org (would leave the user org-less)', () => {
    expect(canDeleteOrganization({ myRole: 'owner', orgCount: 1 })).toBe(false);
  });

  it('is false while the org list is still loading (count 0)', () => {
    expect(canDeleteOrganization({ myRole: 'owner', orgCount: 0 })).toBe(false);
  });

  it('is false for non-owners regardless of org count', () => {
    expect(canDeleteOrganization({ myRole: 'admin', orgCount: 3 })).toBe(false);
    expect(canDeleteOrganization({ myRole: 'member', orgCount: 3 })).toBe(false);
    expect(canDeleteOrganization({ myRole: undefined, orgCount: 3 })).toBe(false);
  });
});

describe('submitInvite', () => {
  const values: InviteValues = { email: 'new@example.com', role: 'member' };

  it('happy path: forwards to inviteMember and calls onSuccess with id', async () => {
    const inviteMember = vi.fn(async () => ({ id: 'inv-1' }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitInvite(values, {
      inviteMember: inviteMember as never,
      setError: setError as never,
      onSuccess,
    });

    expect(inviteMember).toHaveBeenCalledWith(values);
    expect(onSuccess).toHaveBeenCalledWith('inv-1');
    expect(setError).not.toHaveBeenCalled();
  });

  it('400 error from server surfaces via setError on root', async () => {
    const inviteMember = vi.fn(async () => ({
      error: { status: 400, message: 'Already invited' },
    }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitInvite(values, {
      inviteMember: inviteMember as never,
      setError: setError as never,
      onSuccess,
    });

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Already invited',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('thrown error also surfaces via setError', async () => {
    const inviteMember = vi.fn(async () => {
      throw new Error('Network down');
    });
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitInvite(values, {
      inviteMember: inviteMember as never,
      setError: setError as never,
      onSuccess,
    });

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Network down',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
