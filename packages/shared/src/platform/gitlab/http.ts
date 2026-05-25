/**
 * GitLab HTTP plumbing — URL builder and auth headers. Unlike the GitHub
 * sibling, no env-based URL override is needed: `hostUrl` flows in per call
 * from the credential (set by host-data-model). Tests inject `fetchImpl`
 * directly, so there's no module-init env read to worry about.
 */

export function gitlabApiUrl(hostUrl: string): string {
  return `https://${hostUrl}/api/v4`;
}

export function gitlabAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'conduit-poll/0.1',
  };
}
