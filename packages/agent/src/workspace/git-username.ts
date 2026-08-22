import type { ConnectionContext } from './types';

/**
 * Basic-auth username git must send alongside a platform token over HTTPS.
 *
 * GitHub accepts any non-empty username and conventionally uses
 * `x-access-token`. GitLab is stricter: an OAuth access token authenticates
 * only when the username is exactly `oauth2` — anything else comes back as
 * `HTTP Basic: Access denied`. Personal access tokens are unaffected (GitLab
 * ignores the username for those), so `oauth2` is the safe answer for every
 * GitLab credential and we don't need to know which kind we're holding.
 *
 * Both credential-helper paths (`git-helpers.ts` for worker-side clone/fetch,
 * `push-auth.ts` for the agent-side push script) share this so the two can't
 * drift.
 */
export function gitAuthUsername(platform: ConnectionContext['platform']): string {
  return platform === 'gitlab' ? 'oauth2' : 'x-access-token';
}
