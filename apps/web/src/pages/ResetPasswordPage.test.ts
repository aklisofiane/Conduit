import { describe, expect, it, vi } from 'vitest';
import { submitResetPassword, type ResetPasswordValues } from './ResetPasswordPage.js';

describe('submitResetPassword', () => {
  const values: ResetPasswordValues = { password: 'longenough' };

  it('forwards token + newPassword and calls onSuccess', async () => {
    const reset = vi.fn(async () => ({ data: { status: true }, error: null }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitResetPassword(values, {
      reset: reset as never,
      setError: setError as never,
      onSuccess,
      token: 'tok-abc',
    });

    expect(reset).toHaveBeenCalledWith({ token: 'tok-abc', newPassword: 'longenough' });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('surfaces a 400 server error on the root field', async () => {
    const reset = vi.fn(async () => ({
      data: null,
      error: { status: 400, message: 'Token expired' },
    }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitResetPassword(values, {
      reset: reset as never,
      setError: setError as never,
      onSuccess,
      token: 'tok-abc',
    });

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Token expired',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
