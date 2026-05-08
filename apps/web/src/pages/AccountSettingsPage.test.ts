import { describe, expect, it, vi } from 'vitest';
import { submitChangePassword, type ChangePasswordValues } from './AccountSettingsPage.js';

describe('submitChangePassword', () => {
  const values: ChangePasswordValues = {
    currentPassword: 'old',
    newPassword: 'longenough',
    confirmPassword: 'longenough',
  };

  it('forwards current + new password and calls onSuccess', async () => {
    const changePassword = vi.fn(async () => ({ data: { user: {} }, error: null }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitChangePassword(values, {
      changePassword: changePassword as never,
      setError: setError as never,
      onSuccess,
    });

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old',
      newPassword: 'longenough',
    });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('surfaces a 400 server error on the root field', async () => {
    const changePassword = vi.fn(async () => ({
      data: null,
      error: { status: 400, message: 'Invalid password' },
    }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitChangePassword(values, {
      changePassword: changePassword as never,
      setError: setError as never,
      onSuccess,
    });

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Invalid password',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
