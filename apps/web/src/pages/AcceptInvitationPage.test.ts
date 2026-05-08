import { describe, expect, it, vi } from 'vitest';
import {
  describeInvitationError,
  handleAcceptInvitation,
  handleRejectInvitation,
} from './AcceptInvitationPage.js';

describe('handleAcceptInvitation', () => {
  it('happy path navigates to /account/organization', async () => {
    const acceptInvitation = vi.fn(async () => ({ id: 'inv-1' }));
    const navigate = vi.fn();
    const setError = vi.fn();

    await handleAcceptInvitation('inv-1', { acceptInvitation, navigate, setError });

    expect(acceptInvitation).toHaveBeenCalledWith('inv-1');
    expect(navigate).toHaveBeenCalledWith('/account/organization', { replace: true });
    // Resets the error and never sets a non-null one
    expect(setError).toHaveBeenCalledWith(null);
    expect(setError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('expired/invalid token surfaces the server message and does not navigate', async () => {
    const acceptInvitation = vi.fn(async () => {
      throw new Error('Invitation expired');
    });
    const navigate = vi.fn();
    const setError = vi.fn();

    await handleAcceptInvitation('inv-1', { acceptInvitation, navigate, setError });

    expect(navigate).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Invitation expired');
  });
});

describe('handleRejectInvitation', () => {
  it('happy path navigates to /account/invitations', async () => {
    const rejectInvitation = vi.fn(async () => ({ id: 'inv-1' }));
    const navigate = vi.fn();
    const setError = vi.fn();

    await handleRejectInvitation('inv-1', { rejectInvitation, navigate, setError });

    expect(rejectInvitation).toHaveBeenCalledWith('inv-1');
    expect(navigate).toHaveBeenCalledWith('/account/invitations', { replace: true });
  });

  it('error path surfaces and does not navigate', async () => {
    const rejectInvitation = vi.fn(async () => {
      throw new Error('Already rejected');
    });
    const navigate = vi.fn();
    const setError = vi.fn();

    await handleRejectInvitation('inv-1', { rejectInvitation, navigate, setError });

    expect(navigate).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Already rejected');
  });
});

describe('describeInvitationError', () => {
  it('uses the Error message when present', () => {
    expect(describeInvitationError(new Error('Token mismatch'))).toBe('Token mismatch');
  });

  it('falls back to a generic message for non-Errors', () => {
    expect(describeInvitationError(null)).toBe('It may have expired or been revoked.');
    expect(describeInvitationError({})).toBe('It may have expired or been revoked.');
    expect(describeInvitationError('whatever')).toBe('It may have expired or been revoked.');
  });

  it('falls back to generic message for an Error with no message', () => {
    const e = new Error();
    expect(describeInvitationError(e)).toBe('It may have expired or been revoked.');
  });
});
