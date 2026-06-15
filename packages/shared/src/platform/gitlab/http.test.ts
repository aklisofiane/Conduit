import { describe, expect, it } from 'vitest';
import { gitlabApiUrl, gitlabAuthHeaders } from './http';

describe('gitlabApiUrl', () => {
  it('resolves gitlab.com to the cloud API base (matches the MCP preset default)', () => {
    // Writeback relies on this equalling the preset's GITLAB_API_URL so the
    // host override is a no-op for cloud GitLab.
    expect(gitlabApiUrl('gitlab.com')).toBe('https://gitlab.com/api/v4');
  });

  it('interpolates a self-hosted host', () => {
    expect(gitlabApiUrl('gitlab.acme.io')).toBe('https://gitlab.acme.io/api/v4');
  });

  it('preserves an explicit port in the host', () => {
    // The normalized host carries `:port` through verbatim.
    expect(gitlabApiUrl('gitlab.acme.io:8443')).toBe('https://gitlab.acme.io:8443/api/v4');
  });
});

describe('gitlabAuthHeaders', () => {
  it('sets the bearer token and a stable user agent', () => {
    expect(gitlabAuthHeaders('tok-123')).toEqual({
      Authorization: 'Bearer tok-123',
      'User-Agent': 'conduit-poll/0.1',
    });
  });
});
