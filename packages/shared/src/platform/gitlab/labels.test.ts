import { describe, expect, it } from 'vitest';
import { listGitlabProjectLabels } from './labels';

describe('listGitlabProjectLabels', () => {
  it('maps GitLab label fields and strips leading # from color', async () => {
    const canned = [
      { name: 'bug', color: '#d73a4a', description: 'Something is broken' },
      { name: 'enhancement', color: '#0075ca', description: null },
    ];

    const fakeFetch = makeFetch([canned]);
    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(labels).toEqual([
      { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
      { name: 'enhancement', color: '0075ca', description: null },
    ]);
  });

  it('handles color without leading #', async () => {
    const canned = [
      { name: 'test', color: 'aabbcc', description: null },
    ];
    const fakeFetch = makeFetch([canned]);
    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(labels[0]!.color).toBe('aabbcc');
  });

  it('handles missing color as empty string', async () => {
    const canned = [{ name: 'test', description: null }];
    const fakeFetch = makeFetch([canned]);
    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(labels[0]!.color).toBe('');
  });

  it('handles null description', async () => {
    const canned = [
      { name: 'test', color: '#aabbcc', description: null },
    ];
    const fakeFetch = makeFetch([canned]);
    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(labels[0]!.description).toBeNull();
  });

  it('handles undefined description', async () => {
    const canned = [{ name: 'test', color: '#aabbcc' }];
    const fakeFetch = makeFetch([canned]);
    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(labels[0]!.description).toBeNull();
  });

  it('skips entries with missing name', async () => {
    const canned = [
      { name: 'valid', color: '#aaa', description: null },
      { color: '#bbb', description: null },
    ];
    const fakeFetch = makeFetch([canned]);
    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(labels).toHaveLength(1);
    expect(labels[0]!.name).toBe('valid');
  });

  it('paginates until a partial page is returned', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      name: `label-${i}`,
      color: '#000',
      description: null,
    }));
    const page2 = [{ name: 'last', color: '#fff', description: null }];

    const calls: string[] = [];
    const fakeFetch = makeFetch([page1, page2], (url) => calls.push(url));
    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(labels).toHaveLength(101);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('page=1');
    expect(calls[1]).toContain('page=2');
  });

  it('stops at MAX_PAGES ceiling (10)', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      name: `label-${i}`,
      color: '#000',
      description: null,
    }));
    const calls: string[] = [];
    const fakeFetch = makeFetch(
      Array.from({ length: 15 }, () => fullPage),
      (url) => calls.push(url),
    );

    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });

    expect(calls).toHaveLength(10);
    expect(labels).toHaveLength(1000);
  });

  it('throws with error shape on non-2xx response', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('Forbidden', { status: 403 });
    await expect(
      listGitlabProjectLabels({
        hostUrl: 'gitlab.com',
        projectPath: 'acme/api',
        token: 't',
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow(/GitLab REST HTTP 403/);
  });

  it('returns empty array when project has no labels', async () => {
    const fakeFetch = makeFetch([[]]);
    const labels = await listGitlabProjectLabels({
      hostUrl: 'gitlab.com',
      projectPath: 'acme/api',
      token: 't',
      fetchImpl: fakeFetch,
    });
    expect(labels).toEqual([]);
  });
});

// ── Test helpers ─────────────────────────────────────────────────────────

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
