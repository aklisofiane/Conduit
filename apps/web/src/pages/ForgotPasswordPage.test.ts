import { describe, expect, it, vi } from 'vitest';
import { submitForgotPassword, type ForgotPasswordValues } from './ForgotPasswordPage.js';

describe('submitForgotPassword', () => {
  const values: ForgotPasswordValues = { email: 'a@b.test' };

  it('calls request with email + redirectTo and onSuccess on success', async () => {
    const request = vi.fn(async () => ({ data: { status: true }, error: null }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitForgotPassword(values, {
      request: request as never,
      setError: setError as never,
      onSuccess,
    });

    expect(request).toHaveBeenCalledWith({
      email: 'a@b.test',
      redirectTo: '/reset-password',
    });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('surfaces a 400 server error on the root field', async () => {
    const request = vi.fn(async () => ({
      data: null,
      error: { status: 400, message: 'Email not allowed' },
    }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitForgotPassword(values, {
      request: request as never,
      setError: setError as never,
      onSuccess,
    });

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Email not allowed',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
