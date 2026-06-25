import { signIn } from '../../lib/auth-client.js';

/**
 * Social-login button shared by the sign-in and sign-up pages. Relative
 * callback URLs resolve against the API origin, so they're absolutized
 * against `window.location.origin` before being handed to better-auth.
 */
export function OAuthButton({
  provider,
  label,
  callbackURL,
  errorCallbackURL,
}: {
  provider: string;
  label: string;
  callbackURL: string;
  errorCallbackURL?: string;
}) {
  const handleClick = async () => {
    await signIn.social({
      provider: provider as 'github',
      callbackURL: `${window.location.origin}${callbackURL}`,
      errorCallbackURL: errorCallbackURL ? `${window.location.origin}${errorCallbackURL}` : undefined,
    });
  };
  return (
    <button type="button" className="btn justify-center" onClick={handleClick}>
      {label}
    </button>
  );
}
