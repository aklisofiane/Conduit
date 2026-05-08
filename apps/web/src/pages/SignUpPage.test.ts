import { describe, expect, it, vi } from 'vitest';
import { submitSignUp, type SignUpValues } from './SignUpPage.js';

describe('submitSignUp', () => {
  const values: SignUpValues = { name: 'Ada', email: 'a@b.test', password: 'longenough' };

  it('passes name + email + password and calls onSuccess', async () => {
    const signUpEmail = vi.fn(async () => ({ data: { user: {} }, error: null }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitSignUp(values, {
      signUpEmail: signUpEmail as never,
      setError: setError as never,
      onSuccess,
    });

    expect(signUpEmail).toHaveBeenCalledWith({
      email: 'a@b.test',
      password: 'longenough',
      name: 'Ada',
    });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(setError).not.toHaveBeenCalled();
  });

  it('surfaces a 400 server error on the root field', async () => {
    const signUpEmail = vi.fn(async () => ({
      data: null,
      error: { status: 400, message: 'User already exists' },
    }));
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await submitSignUp(values, {
      signUpEmail: signUpEmail as never,
      setError: setError as never,
      onSuccess,
    });

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'User already exists',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
