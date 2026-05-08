import { describe, expect, it, vi } from 'vitest';
import { submitSignIn, type SignInValues } from './SignInPage.js';

describe('submitSignIn', () => {
  const values: SignInValues = { email: 'a@b.test', password: 'pw' };

  it('calls onSuccess when the auth client returns no error', async () => {
    const signInEmail = vi.fn(async () => ({ data: { user: {} }, error: null }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitSignIn(values, {
      signInEmail: signInEmail as never,
      setError: setError as never,
      onSuccess,
    });

    expect(signInEmail).toHaveBeenCalledWith({ email: 'a@b.test', password: 'pw' });
    expect(setError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('surfaces a 400 server error via setError on the root field', async () => {
    const signInEmail = vi.fn(async () => ({
      data: null,
      error: { status: 400, message: 'Invalid credentials' },
    }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitSignIn(values, {
      signInEmail: signInEmail as never,
      setError: setError as never,
      onSuccess,
    });

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Invalid credentials',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
