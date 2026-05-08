import { describe, expect, it, vi } from 'vitest';
import {
  filterPendingInvitations,
  performInvitationAction,
} from './InvitationsPage.js';
import type { UserInvitation } from '../api/organization.js';

function inv(overrides: Partial<UserInvitation> = {}): UserInvitation {
  return {
    id: overrides.id ?? 'inv-1',
    organizationId: 'org-1',
    email: 'a@example.com',
    role: 'member',
    status: overrides.status ?? 'pending',
    inviterId: 'u-2',
    expiresAt: '2026-12-31T00:00:00Z',
    organizationName: 'Acme',
    inviterEmail: 'b@example.com',
    ...overrides,
  } as UserInvitation;
}

describe('filterPendingInvitations', () => {
  it('keeps only pending invitations', () => {
    const list = [
      inv({ id: 'a', status: 'pending' }),
      inv({ id: 'b', status: 'accepted' }),
      inv({ id: 'c', status: 'rejected' }),
      inv({ id: 'd', status: 'pending' }),
      inv({ id: 'e', status: 'expired' }),
    ];
    expect(filterPendingInvitations(list).map((i) => i.id)).toEqual(['a', 'd']);
  });

  it('returns an empty array for an empty list', () => {
    expect(filterPendingInvitations([])).toEqual([]);
  });
});

describe('performInvitationAction', () => {
  it('happy path returns true and clears error', async () => {
    const mutate = vi.fn(async () => ({ id: 'inv-1' }));
    const setError = vi.fn();
    const onSettled = vi.fn();

    const ok = await performInvitationAction({
      invitationId: 'inv-1',
      mutate,
      setError,
      onSettled,
    });

    expect(ok).toBe(true);
    expect(mutate).toHaveBeenCalledWith('inv-1');
    expect(setError).toHaveBeenCalledWith(null);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('error path returns false and surfaces the message', async () => {
    const mutate = vi.fn(async () => {
      throw new Error('Something broke');
    });
    const setError = vi.fn();

    const ok = await performInvitationAction({
      invitationId: 'inv-1',
      mutate,
      setError,
    });

    expect(ok).toBe(false);
    // Both null (clear) then error message
    expect(setError).toHaveBeenCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith('Something broke');
  });

  it('does not call onSettled on failure (so optimistic UI stays consistent)', async () => {
    const mutate = vi.fn(async () => {
      throw new Error('boom');
    });
    const setError = vi.fn();
    const onSettled = vi.fn();

    await performInvitationAction({
      invitationId: 'inv-1',
      mutate,
      setError,
      onSettled,
    });

    expect(onSettled).not.toHaveBeenCalled();
  });
});
