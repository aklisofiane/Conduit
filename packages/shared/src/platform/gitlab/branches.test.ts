import { describe, expect, it } from 'vitest';
import { listGitlabProjectBranches } from './branches';

describe('listGitlabProjectBranches', () => {
  it('maps branch names and hits the project repository/branches endpoint', async () => {
    const calls: string[] = [];
    const fakeFetch = makeFetch(
      [[{ name: 'main' }, { name: 'release/2.0' }]],
      (url) => calls.push(url),
    );

    const branches = await listGitlabProjectBranches({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(branches).toEqual(['main', 'release/2.0']);
    expect(calls[0]).toBe(
      'https://gitlab.com/api/v4/projects/acme%2Fapi/repository/branches?per_page=100&page=1',
    );
  });

  it('skips entries with a missing name', async () => {
    const fakeFetch = makeFetch([[{ name: 'main' }, {}, { name: 'dev' }]]);
    const branches = await listGitlabProjectBranches({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(branches).toEqual(['main', 'dev']);
  });

  it('paginates until a partial page is returned', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ name: `branch-${i}` }));
    const page2 = [{ name: 'last' }];
    const calls: string[] = [];
    const fakeFetch = makeFetch([page1, page2], (url) => calls.push(url));

    const branches = await listGitlabProjectBranches({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(branches).toHaveLength(101);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('page=1');
    expect(calls[1]).toContain('page=2');
  });

  it('throws with error shape on non-2xx response', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('Forbidden', { status: 403 });
    await expect(
      listGitlabProjectBranches({
        hostUrl: 'gitlab.com',
        projectPath: 'acme/api',
        token: 't',
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow(/GitLab REST HTTP 403 listing branches for acme\/api/);
  });

  it('returns an empty array when the project has no branches', async () => {
    const fakeFetch = makeFetch([[]]);
    const branches = await listGitlabProjectBranches({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(branches).toEqual([]);
  });
});

function makeFetch(
  pages: unknown[],
  onCall?: (url: string) => void,
): typeof fetch {
  let call = 0;
  return (async (url: string) => {
    onCall?.(url);
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return new Response(JSON.stringify(page), { status: 200 });
  }) as typeof fetch;
}
