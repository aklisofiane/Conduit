/**
 * Shared GitHub HTTP plumbing for the GraphQL and REST clients in this
 * directory. Both URL helpers read env lazily because this module is
 * re-exported through the root `@conduit/shared` barrel and ends up in
 * the browser bundle (web reads types/schemas from the same barrel).
 * Reading `process.env` at module init crashes Vite — resolve at call
 * time so server consumers still pick up overrides while the web bundle
 * stays inert.
 */

function envVar(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

export function githubGraphqlUrl(): string {
  return envVar('GITHUB_GRAPHQL_URL') ?? 'https://api.github.com/graphql';
}

export function githubRestUrl(): string {
  return envVar('GITHUB_REST_URL') ?? 'https://api.github.com';
}

/** Headers common to GraphQL and REST. Callers add `Content-Type` (for POST
 * bodies) or `X-GitHub-Api-Version` (REST) on top. */
export function githubAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'conduit-poll/0.1',
    Accept: 'application/vnd.github+json',
  };
}
